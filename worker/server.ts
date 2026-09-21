import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { config } from './config.ts'
import { PlaywrightSession } from './playwright/session.ts'
import { parseCommand } from './protocol.ts'
import type { WorkerMessage } from './protocol.ts'

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
    return
  }
  response.writeHead(404)
  response.end()
})
const wss = new WebSocketServer({ server })

wss.on('connection', (ws: WebSocket, request) => {
  // ブラウザーからの接続元を許可リストと照合する。
  const origin = request.headers.origin
  if (!origin || !config.allowedOrigins.has(origin)) {
    ws.close(1008, 'Origin not allowed')
    return
  }

  console.log('クライアントが接続しました')

  let disconnected = false
  let waitingForPong = false
  // マウスやキーボード操作は受信順に実行する。
  let actions = Promise.resolve()

  const sendMessage = (message: WorkerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  const session = new PlaywrightSession({
    sendMessage,
    sendFrame: (frame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame)
    },
    // 前の画像が送信待ちなら次の撮影を見送る。
    canSendFrame: () => ws.readyState === WebSocket.OPEN && ws.bufferedAmount === 0,
  })

  // 応答しない接続を検出し、セッションを残さないようにする。
  const heartbeat = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return
    if (waitingForPong) {
      ws.terminate()
      return
    }
    waitingForPong = true
    try {
      ws.ping()
    } catch {
      ws.terminate()
    }
  }, config.heartbeatMs)

  ws.on('pong', () => { waitingForPong = false })
  ws.on('error', (error) => {
    console.error('WebSocket エラー:', error)
    ws.terminate()
  })
  ws.on('message', (data, isBinary) => {
    if (isBinary || disconnected) return

    actions = actions.then(async () => {
      if (disconnected) return
      const command = parseCommand(data.toString(), config.viewport.width, config.viewport.height)
      if (command) await session.execute(command)
    }).catch((error: unknown) => {
      console.error('操作エラー:', error)
      sendMessage({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました' })
    })
  })
  ws.on('close', () => {
    disconnected = true
    clearInterval(heartbeat)
    void session.close()
    console.log('クライアントが切断されました')
  })

  void session.start().catch((error: unknown) => {
    if (disconnected) return
    console.error('ブラウザーの起動またはページの読み込みに失敗しました:', error)
    ws.close()
    void session.close()
  })
})

server.listen(config.port, config.host, () => {
  console.log(`スクリーンショット配信サーバー起動: ws://${config.host}:${config.port}`)
})
