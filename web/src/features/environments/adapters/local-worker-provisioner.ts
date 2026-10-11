import type { EnvironmentProvisioner, ProvisionedEnvironment } from '../application/ports.ts'
import { EnvironmentConflictError, EnvironmentNotFoundError } from '../domain/environment.ts'

// Development mode has one fixed Worker ID. Do not issue a second browser an
// ownership cookie for the same environment in this web process.
const claimedWorkers = new Set<string>()

// Docker Compose owns the local container lifecycle; this adapter checks readiness.
export class LocalWorkerProvisioner implements EnvironmentProvisioner {
  private readonly sessionId: string
  private readonly websocketUrl: string
  private readonly healthUrl: string

  constructor(sessionId: string, websocketUrl: string) {
    const url = new URL(websocketUrl)
    if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Local Worker URL must be a loopback ws:// URL without credentials, path or query')
    }
    this.sessionId = sessionId
    this.websocketUrl = url.href
    url.protocol = 'http:'
    url.pathname = '/health'
    this.healthUrl = url.href
  }

  async hasActiveEnvironment(): Promise<boolean> { return claimedWorkers.has(this.sessionId) }

  async start(sessionId: string): Promise<void> {
    this.requireSession(sessionId)
    if (claimedWorkers.has(sessionId)) throw new EnvironmentConflictError('A local Worker session is already assigned to a browser')
    claimedWorkers.add(sessionId)
    if (!(await this.healthy())) {
      claimedWorkers.delete(sessionId)
      throw new Error('Start the local Worker with docker compose up --build worker')
    }
  }

  async find(sessionId: string): Promise<ProvisionedEnvironment> {
    this.requireSession(sessionId)
    return await this.healthy()
      ? { state: 'ready', websocketUrl: this.websocketUrl }
      : { state: 'failed', message: 'ローカルWorkerが停止しています。docker compose up --build worker で起動してください。' }
  }

  async stop(sessionId: string): Promise<void> {
    this.requireSession(sessionId)
    // The UI sends the authenticated disconnect command; it shuts down the Worker.
  }

  private requireSession(sessionId: string): void {
    if (sessionId !== this.sessionId) throw new EnvironmentNotFoundError()
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await fetch(this.healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(3000), redirect: 'error' })
      return response.ok && await response.text() === 'ok'
    } catch { return false }
  }
}
