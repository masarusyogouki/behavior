import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiSecurity } from './api-security.ts'
import { environmentHandlers } from './environment-handlers.ts'

const accessKey = 'a'.repeat(43)
const sessionId = '8d1ec3ae-4722-4a74-b31e-b053e232e9df'
const origin = 'https://web.example'
function request(method: string, cookies = '', path = '/api/environments', body?: string) {
  return new Request(`${origin}${path}`, { method, headers: { Origin: origin, Cookie: cookies }, body })
}
function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0] }
function fixture() {
  const calls: string[] = []
  const security = new ApiSecurity(accessKey, 'server-only-secret'.repeat(4))
  const handlers = environmentHandlers({ security: () => security, service: () => ({
    async create() { calls.push('create'); return { sessionId } },
    async status() { calls.push('status'); return { sessionId, state: 'ready', token: 'jwt' } },
    async stop() { calls.push('stop') },
  }) })
  async function login() {
    const result = await handlers.login(request('POST', '', '/api/auth', JSON.stringify({ accessKey })))
    assert.equal(result.status, 204)
    assert.match(result.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Max-Age=25200; Secure/)
    return cookie(result)
  }
  return { calls, security, handlers, login }
}

test('forged matching Origin cannot create, read a JWT, or stop without authentication', async () => {
  const f = fixture()
  for (const method of ['POST', 'GET', 'DELETE']) assert.equal((await f.handlers.handle(request(method), method === 'POST' ? undefined : sessionId)).status, 401)
  assert.deepEqual(f.calls, [])
})

test('only the creating browser can read or stop, even when another browser has the access key', async () => {
  const f = fixture()
  const owner = await f.login()
  const created = await f.handlers.handle(request('POST', owner))
  assert.equal(created.status, 202)
  const ownership = cookie(created)
  const stranger = await f.login()
  for (const method of ['GET', 'DELETE']) {
    assert.equal((await f.handlers.handle(request(method, stranger), sessionId)).status, 403)
    assert.equal((await f.handlers.handle(request(method, `${stranger}; ${ownership}`), sessionId)).status, 403)
  }
  assert.equal((await f.handlers.handle(request('GET', `${owner}; ${ownership}`), 'another-session')).status, 403)
  assert.deepEqual(f.calls, ['create'])
  const ready = await f.handlers.handle(request('GET', `${owner}; ${ownership}`), sessionId)
  assert.equal(ready.status, 200)
  assert.equal((await ready.json()).token, 'jwt')
  assert.equal(ready.headers.get('cache-control'), 'no-store')
  assert.equal((await f.handlers.handle(request('DELETE', `${owner}; ${ownership}`), sessionId)).status, 204)
  assert.deepEqual(f.calls, ['create', 'status', 'stop'])
})

test('rejects incorrect keys, tampered and expired cookies, cross-origin mutations and oversized login bodies', async () => {
  const f = fixture()
  assert.equal((await f.handlers.login(request('POST', '', '/api/auth', JSON.stringify({ accessKey: 'wrong' })))).status, 401)
  const auth = await f.login()
  assert.equal((await f.handlers.handle(request('POST', `${auth}tampered`))).status, 401)
  assert.equal((await f.handlers.handle(request('POST', `${auth}; ${auth}`))).status, 401)
  const originalNow = Date.now
  try {
    Date.now = () => originalNow() + 8 * 60 * 60 * 1000
    assert.equal((await f.handlers.handle(request('POST', auth))).status, 401)
  } finally { Date.now = originalNow }
  assert.equal((await f.handlers.handle(new Request(`${origin}/api/environments`, { method: 'POST', headers: { Origin: 'https://attacker.example', Cookie: auth } }))).status, 403)
  assert.equal((await f.handlers.login(request('POST', '', '/api/auth', 'x'.repeat(1025)))).status, 413)
  assert.deepEqual(f.calls, [])
})

test('missing server configuration fails closed before provisioner access', async () => {
  const handlers = environmentHandlers({ security: () => new ApiSecurity('', ''), service: () => { throw new Error('must not run') } })
  assert.equal((await handlers.handle(request('POST'))).status, 503)
  assert.equal((await handlers.login(request('POST', '', '/api/auth', '{}'))).status, 503)
  assert.throws(() => new ApiSecurity(accessKey, 'secret'.repeat(8)).identity(new Request('http://web.example/api')), /requires HTTPS/)
})
