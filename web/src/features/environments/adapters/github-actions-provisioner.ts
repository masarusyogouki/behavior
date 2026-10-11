import type { EnvironmentProvisioner, ProvisionedEnvironment } from '../application/ports.ts'

const OWNER = 'masarusyogouki'
const REPOSITORY = 'behavior'
const WORKFLOW = 'worker-session.yml'
const REF = 'main'
const RUN_PREFIX = 'Worker Session / session / '

type WorkflowRun = {
  id: number
  display_title: string
  status: string
  conclusion: string | null
  html_url: string
}

type Artifact = {
  id: number
  name: string
  expired: boolean
}

type ConnectionMetadata = {
  sessionId: string
  tunnelUrl: string
}

type GitHubApi = {
  request(path: string, init?: RequestInit): Promise<Response>
}

function repositoryPath(path: string): string {
  return `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPOSITORY)}${path}`
}

function workflowPath(path: string): string {
  return repositoryPath(`/actions/workflows/${encodeURIComponent(WORKFLOW)}${path}`)
}

function sessionRunTitle(sessionId: string): string {
  return `${RUN_PREFIX}${sessionId}`
}

function parseRuns(value: unknown): WorkflowRun[] {
  if (typeof value !== 'object' || value === null || !('workflow_runs' in value) || !Array.isArray(value.workflow_runs)) {
    throw new Error('GitHub API returned an invalid workflow run response')
  }
  return value.workflow_runs.filter((run): run is WorkflowRun => (
    typeof run === 'object'
    && run !== null
    && 'id' in run
    && typeof run.id === 'number'
    && 'display_title' in run
    && typeof run.display_title === 'string'
    && 'status' in run
    && typeof run.status === 'string'
    && 'conclusion' in run
    && (run.conclusion === null || typeof run.conclusion === 'string')
    && 'html_url' in run
    && typeof run.html_url === 'string'
  ))
}

function parseArtifacts(value: unknown): Artifact[] {
  if (typeof value !== 'object' || value === null || !('artifacts' in value) || !Array.isArray(value.artifacts)) {
    throw new Error('GitHub API returned an invalid artifact response')
  }
  return value.artifacts.filter((artifact): artifact is Artifact => (
    typeof artifact === 'object'
    && artifact !== null
    && 'id' in artifact
    && typeof artifact.id === 'number'
    && 'name' in artifact
    && typeof artifact.name === 'string'
    && 'expired' in artifact
    && typeof artifact.expired === 'boolean'
  ))
}

function parseConnectionMetadata(value: unknown, sessionId: string): ConnectionMetadata {
  if (
    typeof value !== 'object'
    || value === null
    || !('sessionId' in value)
    || value.sessionId !== sessionId
    || !('tunnelUrl' in value)
    || typeof value.tunnelUrl !== 'string'
  ) throw new Error('Session artifact contained invalid metadata')
  const url = new URL(value.tunnelUrl)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') || url.pathname !== '/') {
    throw new Error('Session artifact contained an invalid tunnel URL')
  }
  return { sessionId, tunnelUrl: url.href }
}

export class GitHubActionsProvisioner implements EnvironmentProvisioner {
  private readonly github: GitHubApi
  constructor(github: GitHubApi) {
    this.github = github
  }

  private async listRuns(): Promise<WorkflowRun[]> {
    const response = await this.github.request(workflowPath('/runs?event=workflow_dispatch&per_page=30'))
    return parseRuns(await response.json())
  }

  async hasActiveEnvironment(): Promise<boolean> {
    return (await this.listRuns()).some((run) => run.status !== 'completed')
  }

  async start(sessionId: string): Promise<void> {
    await this.github.request(workflowPath('/dispatches'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: REF, inputs: { mode: 'session', session_id: sessionId } }),
    })
  }

  private async findRun(sessionId: string): Promise<WorkflowRun | null> {
    return (await this.listRuns()).find((run) => run.display_title === sessionRunTitle(sessionId)) ?? null
  }

  private async connectionMetadata(run: WorkflowRun, sessionId: string): Promise<ConnectionMetadata | null> {
    const response = await this.github.request(repositoryPath(`/actions/runs/${run.id}/artifacts?per_page=20`))
    const artifact = parseArtifacts(await response.json()).find((item) => (
      !item.expired && (item.name === 'worker-session.json' || item.name === `worker-session-${run.id}`)
    ))
    if (!artifact) return null
    const download = await this.github.request(repositoryPath(`/actions/artifacts/${artifact.id}/zip`))
    const contentLength = Number(download.headers.get('content-length') ?? '0')
    if (contentLength > 65_536) throw new Error('Session artifact is unexpectedly large')
    const text = await download.text()
    if (text.length > 65_536) throw new Error('Session artifact is unexpectedly large')
    return parseConnectionMetadata(JSON.parse(text), sessionId)
  }

  private async tunnelStarted(runId: number): Promise<boolean> {
    const response = await this.github.request(repositoryPath(`/actions/runs/${runId}/jobs?per_page=10`))
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('jobs' in body) || !Array.isArray(body.jobs)) return false
    return body.jobs.some((job) => (
      typeof job === 'object'
      && job !== null
      && 'steps' in job
      && Array.isArray(job.steps)
      && job.steps.some((step: unknown) => (
        typeof step === 'object'
        && step !== null
        && 'name' in step
        && step.name === 'Start Cloudflare Quick Tunnel'
        && 'status' in step
        && step.status !== 'queued'
      ))
    ))
  }

  async find(sessionId: string): Promise<ProvisionedEnvironment | null> {
    const run = await this.findRun(sessionId)
    if (!run) return null
    if (run.status === 'completed') {
      return {
        state: run.conclusion === 'success' || run.conclusion === 'cancelled' ? 'stopped' : 'failed',
        runUrl: run.html_url,
        message: run.conclusion ? `Workflow ended: ${run.conclusion}` : 'Workflow ended',
      }
    }
    if (run.status !== 'in_progress') return { state: 'queued', runUrl: run.html_url }

    const metadata = await this.connectionMetadata(run, sessionId)
    if (!metadata) {
      const state = await this.tunnelStarted(run.id) ? 'tunnel_waiting' : 'building'
      return { state, runUrl: run.html_url }
    }

    const url = new URL(metadata.tunnelUrl)
    url.protocol = 'wss:'
    return { state: 'ready', runUrl: run.html_url, websocketUrl: url.href }
  }

  async stop(sessionId: string): Promise<void> {
    const run = await this.findRun(sessionId)
    if (!run || run.status === 'completed') return
    await this.github.request(repositoryPath(`/actions/runs/${run.id}/cancel`), { method: 'POST' })
  }
}
