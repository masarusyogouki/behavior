import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'

import { EnvironmentService } from '../application/environment-service.ts'
import { EnvironmentConflictError } from '../domain/environment.ts'
import { GitHubActionsProvisioner } from './github-actions-provisioner.ts'
import { JwtSessionTokenIssuer } from './jwt-session-token-issuer.ts'

const sessionId = '8d1ec3ae-4722-4a74-b31e-b053e232e9df'
const run = {
  id: 123,
  display_title: `Worker Session / session / ${sessionId}`,
  status: 'in_progress',
  conclusion: null,
  html_url: 'https://github.com/masarusyogouki/behavior/actions/runs/123',
}

class FakeGitHub {
  readonly requests: Array<{ path: string; init?: RequestInit }> = []
  private readonly responses: Response[]

  constructor(responses: Response[]) {
    this.responses = [...responses]
  }

  async request(path: string, init?: RequestInit): Promise<Response> {
    this.requests.push({ path, init })
    const response = this.responses.shift()
    if (!response) throw new Error(`Unexpected GitHub request: ${path}`)
    return response
  }
}

test('refuses to dispatch while another workflow run is active', async () => {
  const github = new FakeGitHub([Response.json({ workflow_runs: [run] })])
  const service = new EnvironmentService({
    provisioner: new GitHubActionsProvisioner(github),
    tokens: { issue: () => 'unused' },
    newSessionId: () => crypto.randomUUID(),
  })
  await assert.rejects(service.create(), EnvironmentConflictError)
  assert.equal(github.requests.length, 1)
})

test('dispatches session mode with a generated session ID', async () => {
  const github = new FakeGitHub([
    Response.json({ workflow_runs: [] }),
    new Response(null, { status: 204 }),
  ])
  const service = new EnvironmentService({
    provisioner: new GitHubActionsProvisioner(github),
    tokens: { issue: () => 'unused' },
    newSessionId: () => crypto.randomUUID(),
  })
  const created = await service.create()
  assert.match(created.sessionId, /^[0-9a-f-]{36}$/)
  assert.equal(github.requests[1].path, '/repos/masarusyogouki/behavior/actions/workflows/worker-session.yml/dispatches')
  assert.deepEqual(JSON.parse(String(github.requests[1].init?.body)), {
    ref: 'main',
    inputs: { mode: 'session', session_id: created.sessionId },
  })
})

test('returns a signed connection only from matching validated artifact metadata', async () => {
  const github = new FakeGitHub([
    Response.json({ workflow_runs: [run] }),
    Response.json({ artifacts: [{ id: 456, name: 'worker-session.json', expired: false }] }),
    Response.json({ sessionId, tunnelUrl: 'https://example-words.trycloudflare.com' }),
  ])
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const service = new EnvironmentService({
    provisioner: new GitHubActionsProvisioner(github),
    tokens: new JwtSessionTokenIssuer(() => privateKeyPem),
    newSessionId: () => crypto.randomUUID(),
  })

  const status = await service.status(sessionId)
  assert.equal(status.state, 'ready')
  assert.equal(status.websocketUrl, 'wss://example-words.trycloudflare.com/')
  assert.ok(status.token)
  const [header, payload, signature] = status.token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  assert.equal(claims.sessionId, sessionId)
  assert.equal(claims.audience, 'browser-worker')
  assert.equal(
    verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    true,
  )
})

test('maps workflow lifecycle and tunnel preparation to product states', async () => {
  for (const conclusion of ['success', 'cancelled', 'failure']) {
    const provisioner = new GitHubActionsProvisioner(new FakeGitHub([
      Response.json({ workflow_runs: [{ ...run, status: 'completed', conclusion }] }),
    ]))
    const status = await provisioner.find(sessionId)
    assert.equal(status?.state, conclusion === 'failure' ? 'failed' : 'stopped')
  }
  for (const stepStatus of ['queued', 'in_progress']) {
    const provisioner = new GitHubActionsProvisioner(new FakeGitHub([
      Response.json({ workflow_runs: [run] }),
      Response.json({ artifacts: [] }),
      Response.json({ jobs: [{ steps: [{ name: 'Start Cloudflare Quick Tunnel', status: stepStatus }] }] }),
    ]))
    assert.equal((await provisioner.find(sessionId))?.state, stepStatus === 'queued' ? 'building' : 'tunnel_waiting')
  }
  const provisioner = new GitHubActionsProvisioner(new FakeGitHub([Response.json({ workflow_runs: [] })]))
  assert.equal(await provisioner.find(sessionId), null)
})

test('rejects mismatched sessions and unexpected tunnel hosts before issuing a token', async () => {
  for (const metadata of [
    { sessionId: 'different-session', tunnelUrl: 'https://valid.trycloudflare.com/' },
    { sessionId, tunnelUrl: 'https://attacker.example/' },
    { sessionId, tunnelUrl: 'http://valid.trycloudflare.com/' },
  ]) {
    const provisioner = new GitHubActionsProvisioner(new FakeGitHub([
      Response.json({ workflow_runs: [run] }),
      Response.json({ artifacts: [{ id: 456, name: 'worker-session-123', expired: false }] }),
      Response.json(metadata),
    ]))
    await assert.rejects(provisioner.find(sessionId), /invalid/)
  }
})

test('stopping missing or completed runs is harmless and active runs are cancelled', async () => {
  for (const runs of [[], [{ ...run, status: 'completed' }], [run]]) {
    const responses = [Response.json({ workflow_runs: runs })]
    if (runs[0]?.status === 'in_progress') responses.push(new Response(null, { status: 202 }))
    const github = new FakeGitHub(responses)
    await new GitHubActionsProvisioner(github).stop(sessionId)
    if (runs[0]?.status === 'in_progress') {
      assert.equal(github.requests[1].path, '/repos/masarusyogouki/behavior/actions/runs/123/cancel')
      assert.equal(github.requests[1].init?.method, 'POST')
    } else {
      assert.equal(github.requests.length, 1)
    }
  }
})
