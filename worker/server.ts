import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { createWebSocketStream, WebSocket, WebSocketServer } from 'ws'
import { config } from './config.ts'
import { PlaywrightSession } from './playwright/session.ts'
import { parseCommand } from './protocol.ts'
import { VncDisplay } from './vnc/display.ts'
import type { WorkerMessage } from './protocol.ts'

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
    return
  }
  response.writeHead(404).end()
})
const controls = new WebSocketServer({ noServer: true })
const viewers = new WebSocketServer({ noServer: true })
// 一時トークンから、その操作接続が所有する VNC 画面を引く。
const sessions = new Map<string, { port: number; owner: WebSocket }>()

server.on('upgrade', (request, socket, head) => {
  // 操作と画面の両方に同じ Origin 制限を適用する。
  const origin = request.headers.origin
  if (!origin || !config.allowedOrigins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (path === '/') {
    controls.handleUpgrade(request, socket, head, (ws) => controls.emit('connection', ws, request))
  } else if (path.startsWith('/vnc/') && sessions.has(path.slice(5))) {
    viewers.handleUpgrade(request, socket, head, (ws) => viewers.emit('connection', ws, path.slice(5)))
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  }
})

viewers.on('connection', (ws: WebSocket, token: string) => {
  const session = sessions.get(token)
  if (!session || session.owner.readyState !== WebSocket.OPEN) {
    ws.close(1008)
    return
  }
  const tcp = connect(session.port, '127.0.0.1')
  // noVNC の WebSocket とローカル x11vnc の TCP を双方向に流す。
  const stream = createWebSocketStream(ws)
  tcp.on('error', () => ws.close())
  stream.on('error', () => tcp.destroy())
  tcp.on('close', () => ws.close())
  ws.on('close', () => tcp.destroy())
  tcp.pipe(stream).pipe(tcp)
})

controls.on('connection', (ws: WebSocket) => {
  // 操作接続が画面と Chromium の寿命を所有する。
  const token = randomBytes(24).toString('hex')
  const display = new VncDisplay()
  const vncPath = `/vnc/${token}`
  let disconnected = false
  let waitingForPong = false
  // Playwright 操作は受信順に実行する。
  let actions = Promise.resolve()
  const sendMessage = (message: WorkerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }
  const session = new PlaywrightSession({ sendMessage, vncPath, environment: () => display.environment })

  // 応答しない操作接続を閉じ、画面プロセスを残さない。
  const heartbeat = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return
    if (waitingForPong) return ws.terminate()
    waitingForPong = true
    ws.ping()
  }, config.heartbeatMs)
  ws.on('pong', () => { waitingForPong = false })
  ws.on('error', (error) => { console.error('WebSocket エラー:', error); ws.terminate() })
  ws.on('message', (data, isBinary) => {
    if (isBinary || disconnected) return
    actions = actions.then(async () => {
      if (disconnected) return
      const command = parseCommand(data.toString(), config.viewport.width, config.viewport.height)
      if (command) await session.execute(command)
    }).catch((error: unknown) => {
      sendMessage({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました' })
    })
  })
  ws.on('close', () => {
    disconnected = true
    clearInterval(heartbeat)
    sessions.delete(token)
    // Chromium が X display を使い終わってから仮想画面を止める。
    void session.close().finally(() => display.close())
  })

  void (async () => {
    try {
      await display.start()
      if (disconnected) return
      // VNC が待ち受けを始めてからトークンを公開する。
      sessions.set(token, { port: display.port, owner: ws })
      await session.start()
      if (!display.japaneseImeReady) sendMessage({ type: 'error', message: '日本語 IME を起動できませんでした。画面の操作はできます。Worker のログを確認してください。' })
    } catch (error) {
      console.error('VNC またはブラウザーの起動に失敗しました:', error)
      sendMessage({ type: 'error', message: 'ブラウザーの起動に失敗しました' })
      ws.close()
    } finally {
      if (disconnected) display.close()
    }
  })()
})

server.listen(config.port, config.host, () => {
  console.log(`VNC 配信サーバー起動: ws://${config.host}:${config.port}`)
})
