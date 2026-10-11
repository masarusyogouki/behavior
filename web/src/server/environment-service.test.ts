import assert from 'node:assert/strict'
import test from 'node:test'
import { environmentServiceFromEnv } from './environment-service.ts'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { SessionTokenVerifier } from '../../../worker/adapters/security/session-auth.ts'

test('local mode cannot be enabled in production', () => {
  const env: Record<string, string | undefined> = process.env
  const previousMode = process.env.WORKER_CONNECTION_MODE
  const previousNodeEnv = process.env.NODE_ENV
  try {
    process.env.WORKER_CONNECTION_MODE = 'local'
    env.NODE_ENV = 'production'
    assert.throws(environmentServiceFromEnv, /requires development mode/)
  } finally {
    if (previousMode === undefined) delete process.env.WORKER_CONNECTION_MODE
    else process.env.WORKER_CONNECTION_MODE = previousMode
    if (previousNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = previousNodeEnv
  }
})

test('local API service issues JWTs accepted by the actual Worker verifier', async (t) => {
  const server = createServer((_request, response) => response.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const sessionId = 'd0b43fa6-8006-4d95-8cdd-b13810875589'
  const env: Record<string, string | undefined> = process.env
  const values = {
    NODE_ENV: 'development', WORKER_CONNECTION_MODE: 'local',
    WORKER_SESSION_ID: sessionId, WORKER_LOCAL_WS_URL: `ws://127.0.0.1:${address.port}`,
    WORKER_SESSION_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, env[name]]))
  try {
    Object.assign(env, values)
    const service = environmentServiceFromEnv()
    assert.deepEqual(await service.create(), { sessionId })
    const status = await service.status(sessionId)
    assert.equal(status.state, 'ready')
    assert.ok('token' in status && status.token)
    const verifier = new SessionTokenVerifier({
      sessionId, audience: 'browser-worker', maxTokenTtlSeconds: 300,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    assert.ok(verifier.verifyAndConsume(status.token))
    assert.equal(verifier.verifyAndConsume(status.token), null)
    const next = await environmentServiceFromEnv().status(sessionId)
    assert.ok('token' in next && next.token)
    assert.ok(verifier.verifyAndConsume(next.token))
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }
  }
})
