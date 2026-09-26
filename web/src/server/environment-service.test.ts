import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'

import { EnvironmentConflictError, EnvironmentService } from './environment-service.ts'

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
  const service = new EnvironmentService(github)
  await assert.rejects(service.create(), EnvironmentConflictError)
  assert.equal(github.requests.length, 1)
})

test('dispatches session mode with a generated session ID', async () => {
  const github = new FakeGitHub([
    Response.json({ workflow_runs: [] }),
    new Response(null, { status: 204 }),
  ])
  const service = new EnvironmentService(github)
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
  const service = new EnvironmentService(github, () => privateKeyPem)

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
