import assert from 'node:assert/strict'
import test from 'node:test'
import { EnvironmentService } from './environment-service.ts'
import { EnvironmentConflictError, EnvironmentNotFoundError } from '../domain/environment.ts'
import type { EnvironmentProvisioner, ProvisionedEnvironment } from './ports.ts'

const sessionId = '8d1ec3ae-4722-4a74-b31e-b053e232e9df'

function fixture() {
  const calls: string[] = []
  let active = false
  let environment: ProvisionedEnvironment | null = null
  const provisioner: EnvironmentProvisioner = {
    async hasActiveEnvironment() { calls.push('active'); return active },
    async start(id) { calls.push(`start:${id}`) },
    async find(id) { calls.push(`find:${id}`); return environment },
    async stop(id) { calls.push(`stop:${id}`) },
  }
  const service = new EnvironmentService({
    provisioner,
    tokens: { issue(id) { calls.push(`token:${id}`); return 'signed-token' } },
    newSessionId() { calls.push('id'); return sessionId },
  })
  return {
    calls, service,
    active(value: boolean) { active = value },
    environment(value: ProvisionedEnvironment | null) { environment = value },
  }
}

test('creates through a provider-independent port and refuses a second active environment', async () => {
  const f = fixture()
  assert.deepEqual(await f.service.create(), { sessionId })
  assert.deepEqual(f.calls, ['active', 'id', `start:${sessionId}`])
  f.calls.length = 0
  f.active(true)
  await assert.rejects(f.service.create(), EnvironmentConflictError)
  assert.deepEqual(f.calls, ['active'])
})

test('issues connection tokens only for ready environments', async () => {
  const f = fixture()
  assert.deepEqual(await f.service.status(sessionId), { sessionId, state: 'queued' })
  for (const state of ['queued', 'building', 'tunnel_waiting', 'failed', 'stopped'] as const) {
    f.environment({ state, runUrl: 'https://run.example', message: 'status' })
    assert.deepEqual(await f.service.status(sessionId), { sessionId, state, runUrl: 'https://run.example', message: 'status' })
  }
  assert.equal(f.calls.some((call) => call.startsWith('token:')), false)
  f.environment({ state: 'ready', websocketUrl: 'wss://worker.example/' })
  assert.deepEqual(await f.service.status(sessionId), {
    sessionId, state: 'ready', websocketUrl: 'wss://worker.example/', token: 'signed-token',
  })
})

test('rejects invalid session IDs before any external operation', async () => {
  const f = fixture()
  await assert.rejects(f.service.status('invalid'), EnvironmentNotFoundError)
  await assert.rejects(f.service.stop('invalid'), EnvironmentNotFoundError)
  assert.deepEqual(f.calls, [])
  await f.service.stop(sessionId)
  assert.deepEqual(f.calls, [`stop:${sessionId}`])
})
