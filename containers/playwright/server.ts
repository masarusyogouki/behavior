import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { WebSocket, WebSocketServer } from 'ws'

const FPS = 5
const INTERVAL_MS = 1000 / FPS
const wss = new WebSocketServer({ host: '0.0.0.0', port: 3000 })

wss.on('connection', (ws: WebSocket) => {
  console.log('クライアントが接続しました')

  let browser: Browser | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let isCapturing = false
  let disconnected = false

  ws.on('close', () => {
    disconnected = true
    if (interval) clearInterval(interval)
    void browser?.close()
    console.log('クライアントが切断されました')
  })

  void (async () => {
    try {
      browser = await chromium.launch({ headless: true })
      if (disconnected) {
        await browser.close()
        return
      }

      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      await page.goto('https://en.wikipedia.org/wiki/Main_Page')
      if (disconnected) return

      interval = setInterval(() => {
        if (isCapturing || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 0) return
        isCapturing = true

        void page.screenshot({ type: 'jpeg', quality: 60 })
          .then((screenshot) => ws.send(screenshot))
          .catch((error: unknown) => console.error('キャプチャエラー:', error))
          .finally(() => { isCapturing = false })
      }, INTERVAL_MS)
    } catch (error) {
      console.error('ブラウザーの起動またはページの読み込みに失敗しました:', error)
      ws.close()
      await browser?.close()
    }
  })()
})

console.log('スクリーンショット配信サーバー起動: ws://0.0.0.0:3000')
