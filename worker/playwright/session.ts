import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { config } from '../config.ts'
import type { BrowserCommand, WorkerMessage } from '../protocol.ts'

type SessionOutput = {
  sendMessage(message: WorkerMessage): void
  sendFrame(frame: Buffer): void
  canSendFrame(): boolean
}

export class PlaywrightSession {
  private readonly output: SessionOutput
  private browser?: Browser
  private context?: BrowserContext
  private page?: Page
  private captureTimer?: ReturnType<typeof setInterval>
  private capturing = false
  private closed = false
  private closePromise?: Promise<void>

  constructor(output: SessionOutput) {
    this.output = output
  }

  async start(): Promise<void> {
    // 接続が起動途中で閉じられた場合、作成済みの資源をその場で破棄する。
    const browser = await chromium.launch({ headless: true })
    if (this.closed) {
      await browser.close()
      return
    }
    this.browser = browser

    const context = await browser.newContext({ viewport: config.viewport })
    if (this.closed) {
      await context.close()
      return
    }
    this.context = context

    const page = await context.newPage()
    if (this.closed) {
      await page.close()
      return
    }
    this.page = page
    // iframe の遷移ではアドレスバーを更新しない。
    page.on('framenavigated', (frame) => {
      if (!this.closed && frame === page.mainFrame()) {
        this.output.sendMessage({ type: 'url', url: frame.url() })
      }
    })

    await page.goto(config.initialUrl, { waitUntil: 'domcontentloaded' })
    if (this.closed) return
    this.output.sendMessage({ type: 'ready', url: page.url(), fps: String(config.fps) })
    this.captureTimer = setInterval(() => { void this.captureFrame() }, 1000 / config.fps)
  }

  async execute(command: BrowserCommand): Promise<void> {
    const page = this.page
    if (this.closed || !page || page.isClosed()) return

    switch (command.type) {
      case 'move':
        await page.mouse.move(command.x, command.y)
        break
      case 'down':
      case 'up':
        await page.mouse.move(command.x, command.y)
        if (command.type === 'down') {
          await page.mouse.down({ button: command.button })
        } else {
          await page.mouse.up({ button: command.button })
        }
        break
      case 'wheel':
        await page.mouse.move(command.x, command.y)
        await page.mouse.wheel(command.deltaX, command.deltaY)
        break
      case 'key':
        await page.keyboard.press(command.key)
        break
      case 'text':
        await page.keyboard.insertText(command.text)
        break
      case 'navigate': {
        const input = command.url.trim()
        if (!input) break
        const url = new URL(input.includes('://') ? input : `https://${input}`)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('http または https の URL を指定してください')
        }
        await page.goto(url.href, { waitUntil: 'domcontentloaded' })
        break
      }
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded' })
        break
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded' })
        break
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded' })
        break
    }
  }

  close(): Promise<void> {
    // 切断と起動失敗の両方から呼ばれても終了処理は一度だけ行う。
    if (this.closePromise) return this.closePromise
    this.closed = true
    if (this.captureTimer) clearInterval(this.captureTimer)
    this.closePromise = this.closeBrowser()
    return this.closePromise
  }

  private async captureFrame(): Promise<void> {
    // 撮影を重ねず、通信が詰まっている間は古いフレームを作らない。
    if (this.closed || this.capturing || !this.output.canSendFrame()) return
    const page = this.page
    if (!page || page.isClosed()) return
    this.capturing = true
    try {
      const frame = await page.screenshot({ type: 'jpeg', quality: config.jpegQuality })
      if (!this.closed && this.output.canSendFrame()) this.output.sendFrame(frame)
    } catch (error) {
      if (!this.closed) console.error('キャプチャエラー:', error)
    } finally {
      this.capturing = false
    }
  }

  private async closeBrowser(): Promise<void> {
    try {
      await this.context?.close()
    } catch (error) {
      console.error('コンテキスト終了エラー:', error)
    }
    try {
      await this.browser?.close()
    } catch (error) {
      console.error('ブラウザー終了エラー:', error)
    }
    this.page = undefined
    this.context = undefined
    this.browser = undefined
  }
}
