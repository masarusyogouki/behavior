import { readFile } from 'node:fs/promises'
import { randomUUID, sign } from 'node:crypto'

const { default: WebSocket } = await import(process.env.BEHAVIOR_WS_MODULE || 'ws')

const [urlValue, sessionId, privateKeyPath, mode = 'full'] = process.argv.slice(2)
if (!urlValue || !sessionId || !privateKeyPath) {
  throw new Error('usage: node remote-session-auth-probe.mjs <wss-url> <session-id> <private-key-path> [full|abrupt-disconnect]')
}
if (!['full', 'abrupt-disconnect'].includes(mode)) throw new Error('invalid probe mode')

const url = new URL(urlValue)
if (url.protocol !== 'wss:' || !url.hostname.endsWith('.trycloudflare.com') || url.pathname !== '/') {
  throw new Error('the WebSocket URL must be a root trycloudflare.com wss URL')
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
  throw new Error('invalid session ID')
}

const privateKey = await readFile(privateKeyPath, 'utf8')
const origin = 'https://web.youdawanchi.workers.dev'
const controlProtocol = 'behavior.v1'
const jwtProtocol = (token) => `behavior.jwt.${token}`
const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function createToken({ tokenSessionId = sessionId, exp = Math.floor(Date.now() / 1000) + 120, jti = randomUUID() } = {}) {
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64urlJson({ sessionId: tokenSessionId, audience: 'browser-worker', exp, jti })
  const signingInput = `${header}.${payload}`
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

function connect(protocols) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols, { origin })
    const timeout = setTimeout(() => reject(new Error('connection timed out')), 15_000)
    ws.once('open', () => {
      clearTimeout(timeout)
      resolve({ ws })
    })
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      response.resume()
      resolve({ status: response.statusCode })
    })
    ws.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

async function expectRejected(label, protocols, expectedStatus) {
  const result = await connect(protocols)
  if (result.ws) {
    result.ws.terminate()
    throw new Error(`${label}: connection was accepted unexpectedly`)
  }
  if (result.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, got ${result.status}`)
  }
  console.log(`${label}: HTTP ${expectedStatus}`)
}

function waitForReady(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('valid JWT: Worker ready message timed out')), 90_000)
    ws.on('message', (data) => {
      let message
      try { message = JSON.parse(data.toString()) } catch { return }
      if (message.type === 'error') {
        clearTimeout(timeout)
        reject(new Error(`valid JWT: ${message.message}`))
      }
      if (message.type === 'ready') {
        clearTimeout(timeout)
        resolve()
      }
    })
    ws.once('close', () => {
      clearTimeout(timeout)
      reject(new Error('valid JWT: connection closed before Worker became ready'))
    })
  })
}

if (mode === 'abrupt-disconnect') {
  const token = createToken()
  const connection = await connect([controlProtocol, jwtProtocol(token)])
  if (!connection.ws) throw new Error(`abrupt disconnect: expected a connection, got HTTP ${connection.status}`)
  await waitForReady(connection.ws)
  const closed = new Promise((resolve) => connection.ws.once('close', resolve))
  connection.ws.terminate()
  await closed
  console.log('abrupt disconnect after Worker ready: connection closed')
  process.exit(0)
}

await expectRejected('missing JWT', [controlProtocol], 401)
await expectRejected('expired JWT', [controlProtocol, jwtProtocol(createToken({ exp: Math.floor(Date.now() / 1000) - 1 }))], 401)
await expectRejected('different session JWT', [controlProtocol, jwtProtocol(createToken({ tokenSessionId: randomUUID() }))], 401)

const primaryToken = createToken()
const primary = await connect([controlProtocol, jwtProtocol(primaryToken)])
if (!primary.ws) throw new Error(`valid JWT: expected a connection, got HTTP ${primary.status}`)
console.log('valid JWT: connected')

await expectRejected('second active connection', [controlProtocol, jwtProtocol(createToken())], 409)
await waitForReady(primary.ws)
console.log('valid JWT: Worker ready')
const closed = new Promise((resolve) => primary.ws.once('close', resolve))
primary.ws.terminate()
await closed

const replayDeadline = Date.now() + 30_000
while (true) {
  const replay = await connect([controlProtocol, jwtProtocol(primaryToken)])
  if (replay.ws) {
    replay.ws.terminate()
    throw new Error('used JWT: connection was accepted unexpectedly')
  }
  if (replay.status === 401) {
    console.log('used JWT: HTTP 401')
    break
  }
  if (replay.status !== 409 || Date.now() >= replayDeadline) {
    throw new Error(`used JWT: expected HTTP 401, got ${replay.status}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

const shutdownToken = createToken()
const shutdown = await connect([controlProtocol, jwtProtocol(shutdownToken)])
if (!shutdown.ws) throw new Error(`explicit disconnect: expected a connection, got HTTP ${shutdown.status}`)
await waitForReady(shutdown.ws)
const shutdownClosed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('explicit disconnect: connection did not close')), 30_000)
  shutdown.ws.once('close', () => {
    clearTimeout(timeout)
    resolve()
  })
})
shutdown.ws.send(JSON.stringify({ type: 'disconnect' }))
await shutdownClosed
console.log('explicit disconnect: connection closed')

console.log('remote session authentication checks: OK')
