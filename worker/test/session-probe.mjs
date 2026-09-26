import WebSocket from 'ws'

const url = process.env.TEST_WS_URL
const token = process.env.TEST_SESSION_TOKEN
const secondToken = process.env.TEST_SECOND_SESSION_TOKEN
if (!url || !token || !secondToken) throw new Error('probe environment is incomplete')

const protocols = (value) => ['behavior.v1', `behavior.jwt.${value}`]
const options = { origin: 'http://localhost:3001' }

function openSocket(value) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols(value), options)
    const timeout = setTimeout(() => reject(new Error('connection timed out')), 10_000)
    ws.once('open', () => { clearTimeout(timeout); resolve(ws) })
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      response.resume()
      reject(new Error(`unexpected HTTP ${response.statusCode}`))
    })
    ws.once('error', reject)
  })
}

function expectRejected(value, expectedStatus) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols(value), options)
    const timeout = setTimeout(() => reject(new Error('rejection timed out')), 10_000)
    ws.once('open', () => {
      clearTimeout(timeout)
      ws.terminate()
      reject(new Error('connection was accepted unexpectedly'))
    })
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      response.resume()
      if (response.statusCode === expectedStatus) resolve()
      else reject(new Error(`expected HTTP ${expectedStatus}, got ${response.statusCode}`))
    })
    ws.once('error', () => { /* unexpected-response carries the useful status */ })
  })
}

function waitForReady(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker ready message timed out')), 60_000)
    ws.on('message', (data) => {
      let message
      try { message = JSON.parse(data.toString()) } catch { return }
      if (message.type === 'error') {
        clearTimeout(timeout)
        reject(new Error(message.message))
      } else if (message.type === 'ready') {
        clearTimeout(timeout)
        resolve()
      }
    })
    ws.once('close', () => {
      clearTimeout(timeout)
      reject(new Error('control connection closed before ready'))
    })
  })
}

const primary = await openSocket(token)
await expectRejected(secondToken, 409)
await waitForReady(primary)
primary.terminate()
await new Promise((resolve) => primary.once('close', resolve))
await new Promise((resolve) => setTimeout(resolve, 1_000))
await expectRejected(token, 401)
console.log('authenticated connection, single-connection limit, and token replay rejection: OK')
