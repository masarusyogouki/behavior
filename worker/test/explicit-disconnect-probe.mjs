import WebSocket from 'ws'

const url = process.env.TEST_WS_URL
const token = process.env.TEST_SESSION_TOKEN
if (!url || !token) throw new Error('probe environment is incomplete')

const ws = new WebSocket(url, ['behavior.v1', `behavior.jwt.${token}`], {
  origin: 'http://localhost:3001',
})
const timeout = setTimeout(() => {
  ws.terminate()
  throw new Error('explicit disconnect probe timed out')
}, 60_000)

await new Promise((resolve, reject) => {
  ws.once('error', reject)
  ws.once('close', resolve)
  ws.on('message', (data) => {
    let message
    try { message = JSON.parse(data.toString()) } catch { return }
    if (message.type === 'error') reject(new Error(message.message))
    if (message.type === 'ready') ws.send(JSON.stringify({ type: 'disconnect' }))
  })
})
clearTimeout(timeout)
console.log('explicit disconnect command: OK')
