import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { LocalWorkerProvisioner } from './local-worker-provisioner.ts'
import { EnvironmentConflictError, EnvironmentNotFoundError } from '../domain/environment.ts'

const sessionId = 'd0b43fa6-8006-4d95-8cdd-b13810875589'

test('local provisioner checks health and returns the local endpoint only for its session', async (t) => {
  let healthy = true
  const server = createServer((request, response) => {
    assert.equal(request.url, '/health')
    response.writeHead(healthy ? 200 : 503).end(healthy ? 'ok' : 'unavailable')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `ws://127.0.0.1:${address.port}/`
  const provisioner = new LocalWorkerProvisioner(sessionId, url)
  await provisioner.start(sessionId)
  assert.equal(await new LocalWorkerProvisioner(sessionId, url).hasActiveEnvironment(), true)
  await assert.rejects(new LocalWorkerProvisioner(sessionId, url).start(sessionId), EnvironmentConflictError)
  assert.deepEqual(await provisioner.find(sessionId), { state: 'ready', websocketUrl: url })
  await assert.rejects(provisioner.find('another-session'), EnvironmentNotFoundError)
  healthy = false
  assert.equal((await provisioner.find(sessionId)).state, 'failed')
  await assert.rejects(provisioner.start(sessionId), EnvironmentConflictError)
})

test('local provisioner rejects remote URLs and redirects to a remote health endpoint', async (t) => {
  for (const url of ['wss://127.0.0.1:3000', 'ws://example.com', 'ws://127.0.0.1/private', 'ws://user:pass@localhost', 'ws://localhost/?x=1']) {
    assert.throws(() => new LocalWorkerProvisioner(sessionId, url), /loopback/)
  }
  const server = createServer((_request, response) => response.writeHead(302, { Location: 'http://example.com' }).end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const provisioner = new LocalWorkerProvisioner(sessionId, `ws://127.0.0.1:${address.port}`)
  assert.equal((await provisioner.find(sessionId)).state, 'failed')
})
