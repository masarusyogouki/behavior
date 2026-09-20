import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { WebSocket, WebSocketServer } from 'ws'

const FPS = 30
const INTERVAL_MS = 1000 / FPS
const wss = new WebSocketServer({ host: '0.0.0.0', port: 3000 })
type MouseButton = 'left' | 'middle' | 'right'

function isPoint(value: Record<string, unknown>): value is Record<string, unknown> & { x: number; y: number } {
  return typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y)
    && value.x >= 0 && value.x < 1280 && value.y >= 0 && value.y < 720
}

wss.on('connection', (ws: WebSocket, request) => {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(request.headers.origin ?? '')) {
    ws.close(1008, 'Origin not allowed')
    return
  }

  console.log('クライアントが接続しました')

  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let isCapturing = false
  let disconnected = false
  let actions = Promise.resolve()
  let waitingForPong = false

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
  }, 15_000)

  ws.on('pong', () => { waitingForPong = false })
  ws.on('error', (error) => {
    console.error('WebSocket エラー:', error)
    ws.terminate()
  })

  const sendJson = (message: Record<string, string>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  const closeSession = async () => {
    const activeContext = context
    const activeBrowser = browser
    context = undefined
    browser = undefined

    try {
      await activeContext?.close()
    } catch (error) {
      console.error('コンテキスト終了エラー:', error)
    }
    try {
      await activeBrowser?.close()
    } catch (error) {
      console.error('ブラウザー終了エラー:', error)
    }
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary || disconnected) return

    actions = actions.then(async () => {
      const activePage = page
      if (disconnected || !activePage || activePage.isClosed()) return
      const message = JSON.parse(data.toString()) as Record<string, unknown>

      switch (message.type) {
        case 'move':
          if (isPoint(message)) {
            await activePage.mouse.move(message.x, message.y)
          }
          break
        case 'down':
        case 'up':
          if (isPoint(message) && ['left', 'middle', 'right'].includes(String(message.button))) {
            await activePage.mouse.move(message.x, message.y)
            if (message.type === 'down') {
              await activePage.mouse.down({ button: message.button as MouseButton })
            } else {
              await activePage.mouse.up({ button: message.button as MouseButton })
            }
          }
          break
        case 'wheel':
          if (isPoint(message) && typeof message.deltaX === 'number' && Number.isFinite(message.deltaX)
            && typeof message.deltaY === 'number' && Number.isFinite(message.deltaY)) {
            await activePage.mouse.move(message.x, message.y)
            await activePage.mouse.wheel(message.deltaX, message.deltaY)
          }
          break
        case 'key':
          if (typeof message.key === 'string' && message.key.length <= 100) {
            await activePage.keyboard.press(message.key)
          }
          break
        case 'text':
          if (typeof message.text === 'string' && message.text.length <= 1000) {
            await activePage.keyboard.insertText(message.text)
          }
          break
        case 'navigate':
          if (typeof message.url === 'string') {
            const input = message.url.trim()
            if (!input) break
            const url = new URL(input.includes('://') ? input : `https://${input}`)
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http または https の URL を指定してください')
            await activePage.goto(url.href, { waitUntil: 'domcontentloaded' })
          }
          break
        case 'back':
          await activePage.goBack({ waitUntil: 'domcontentloaded' })
          break
        case 'forward':
          await activePage.goForward({ waitUntil: 'domcontentloaded' })
          break
        case 'reload':
          await activePage.reload({ waitUntil: 'domcontentloaded' })
          break
      }
    }).catch((error: unknown) => {
      console.error('操作エラー:', error)
      sendJson({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました' })
    })
  })

  ws.on('close', () => {
    disconnected = true
    clearInterval(heartbeat)
    if (interval) clearInterval(interval)
    void closeSession()
    console.log('クライアントが切断されました')
  })

  void (async () => {
    try {
      const activeBrowser = await chromium.launch({ headless: true })
      browser = activeBrowser
      if (disconnected) {
        await closeSession()
        return
      }

      const activeContext = await activeBrowser.newContext({ viewport: { width: 1280, height: 720 } })
      context = activeContext
      if (disconnected) {
        await closeSession()
        return
      }

      const activePage = await activeContext.newPage()
      page = activePage
      activePage.on('framenavigated', (frame) => {
        if (frame === activePage.mainFrame()) sendJson({ type: 'url', url: frame.url() })
      })
      await activePage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' })
      if (disconnected) return
      sendJson({ type: 'ready', url: activePage.url(), fps: String(FPS) })

      interval = setInterval(() => {
        if (isCapturing || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 0) return
        isCapturing = true

        void activePage.screenshot({ type: 'jpeg', quality: 60 })
          .then((screenshot) => ws.send(screenshot))
          .catch((error: unknown) => console.error('キャプチャエラー:', error))
          .finally(() => { isCapturing = false })
      }, INTERVAL_MS)
    } catch (error) {
      console.error('ブラウザーの起動またはページの読み込みに失敗しました:', error)
      ws.close()
      await closeSession()
    }
  })()
})

console.log('スクリーンショット配信サーバー起動: ws://0.0.0.0:3000')
