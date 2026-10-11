import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import { createWebSocketStream, WebSocket, WebSocketServer } from 'ws'
import type { WorkerMessage } from '../../shared/contracts/browser.ts'
import type { RemoteSession } from '../application/remote-session.ts'
import { parseCommand } from '../../shared/contracts/browser.ts'
import { controlProtocol, tokenFromProtocols } from './security/session-auth.ts'

export type WorkerServerOptions = {
  config: {
    host: string
    port: number
    allowedOrigins: ReadonlySet<string>
    viewport: { width: number; height: number }
    heartbeatMs: number
    disconnectGraceMs: number
  }
  tokenVerifier?: { verifyAndConsume(token: string): unknown }
  createSession(sendMessage: (message: WorkerMessage) => void, vncPath: string): {
    session: RemoteSession
    vncPort: number
  }
}

export function createWorkerServer({ config, tokenVerifier, createSession }: WorkerServerOptions) {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ok')
      return
    }
    response.writeHead(404).end()
  })
  const controls = new WebSocketServer({
    maxPayload: 16_384,
    noServer: true,
    handleProtocols: (protocols) => protocols.has(controlProtocol()) ? controlProtocol() : false,
  })
  const viewers = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 })

  type VncSession = { port: number; owner: WebSocket; viewer?: WebSocket }
  const sessions = new Map<string, VncSession>()
  let activeControl: WebSocket | undefined
  let idleShutdownTimer: NodeJS.Timeout | undefined
  let shuttingDown = false

  if (!tokenVerifier) console.warn('Session authentication is not configured; control connections will be rejected.')

  function rejectUpgrade(socket: Duplex, status: number, message: string): void {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
  }

  function clearIdleShutdown(): void {
    if (!idleShutdownTimer) return
    clearTimeout(idleShutdownTimer)
    idleShutdownTimer = undefined
  }

  function shutdownWorker(exitCode: number, reason: string): void {
    if (shuttingDown) return
    shuttingDown = true
    clearIdleShutdown()
    console.log(`Stopping Worker: ${reason}`)
    process.exitCode = exitCode
    server.close(() => process.exit(exitCode))
    setTimeout(() => process.exit(exitCode), 5_000).unref()
  }

  function scheduleIdleShutdown(): void {
    if (activeControl || idleShutdownTimer || shuttingDown) return
    console.log(`No control connection; Worker will stop in ${config.disconnectGraceMs / 60_000} minutes.`)
    idleShutdownTimer = setTimeout(() => {
      idleShutdownTimer = undefined
      if (!activeControl) shutdownWorker(0, 'disconnect grace period expired')
    }, config.disconnectGraceMs)
  }

  server.on('upgrade', (request, socket, head) => {
    if (shuttingDown) return rejectUpgrade(socket, 503, 'Service Unavailable')
    const origin = request.headers.origin
    if (!origin || !config.allowedOrigins.has(origin)) return rejectUpgrade(socket, 403, 'Forbidden')

    let path: string
    try { path = new URL(request.url ?? '/', 'http://localhost').pathname } catch {
      return rejectUpgrade(socket, 400, 'Bad Request')
    }

    if (path === '/') {
      if (activeControl) return rejectUpgrade(socket, 409, 'Conflict')
      if (!tokenVerifier) return rejectUpgrade(socket, 503, 'Service Unavailable')
      const token = tokenFromProtocols(request.headers['sec-websocket-protocol'])
      if (!token || !tokenVerifier.verifyAndConsume(token)) return rejectUpgrade(socket, 401, 'Unauthorized')
      clearIdleShutdown()
      controls.handleUpgrade(request, socket, head, (ws) => {
        activeControl = ws
        controls.emit('connection', ws, request)
      })
      return
    }

    const token = path.startsWith('/vnc/') ? path.slice(5) : ''
    const session = sessions.get(token)
    if (!session || session.owner.readyState !== WebSocket.OPEN || session.viewer) {
      return rejectUpgrade(socket, 404, 'Not Found')
    }
    viewers.handleUpgrade(request, socket, head, (ws) => viewers.emit('connection', ws, token))
  })

  viewers.on('connection', (ws: WebSocket, token: string) => {
    const session = sessions.get(token)
    if (!session || session.owner.readyState !== WebSocket.OPEN || session.viewer) {
      ws.close(1008)
      return
    }
    session.viewer = ws
    const tcp = connect(session.port, '127.0.0.1')
    const stream = createWebSocketStream(ws)
    tcp.on('error', () => ws.close())
    stream.on('error', () => tcp.destroy())
    tcp.on('close', () => ws.close())
    ws.on('close', () => {
      tcp.destroy()
      if (session.viewer === ws) session.viewer = undefined
    })
    tcp.pipe(stream).pipe(tcp)
  })

  controls.on('connection', (ws: WebSocket) => {
    const token = randomBytes(24).toString('hex')
    const vncPath = `/vnc/${token}`
    let disconnected = false
    let explicitDisconnect = false
    let fatalFailure = false
    let waitingForPong = false
    let actions = Promise.resolve()
    let pendingActions = 0
    const sendMessage = (message: WorkerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    }
    const { session, vncPort } = createSession(sendMessage, vncPath)

    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (waitingForPong) return ws.terminate()
      waitingForPong = true
      ws.ping()
    }, config.heartbeatMs)
    ws.on('pong', () => { waitingForPong = false })
    ws.on('error', (error) => { console.error('WebSocket error:', error); ws.terminate() })
    ws.on('message', (data, isBinary) => {
      if (isBinary || disconnected) return
      if (pendingActions >= 128) { ws.close(1008, 'too many pending commands'); return }
      pendingActions++
      actions = actions.then(async () => {
        if (disconnected) return
        const command = parseCommand(data.toString(), config.viewport.width, config.viewport.height)
        if (!command) return
        if (command.type === 'disconnect') {
          explicitDisconnect = true
          ws.close(1000, 'client requested shutdown')
          return
        }
        await session.execute(command)
      }).catch((error: unknown) => {
        sendMessage({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました' })
      }).finally(() => { pendingActions-- })
    })
    ws.on('close', () => {
      disconnected = true
      clearInterval(heartbeat)
      const vncSession = sessions.get(token)
      vncSession?.viewer?.close(1000)
      sessions.delete(token)
      void session.close().finally(() => {
        if (activeControl === ws) activeControl = undefined
        if (fatalFailure) shutdownWorker(1, 'browser or VNC startup failed')
        else if (explicitDisconnect) shutdownWorker(0, 'client requested shutdown')
        else scheduleIdleShutdown()
      })
    })

    void (async () => {
      try {
        await session.start(() => {
          sessions.set(token, { port: vncPort, owner: ws })
        })
      } catch (error) {
        fatalFailure = true
        console.error('VNC or browser startup failed:', error)
        sendMessage({ type: 'error', message: 'ブラウザーの起動に失敗しました' })
        ws.close(1011, 'startup failed')
      }
    })()
  })

  return server
}
