import type { BrowserCommand, WorkerMessage } from '../../shared/contracts/browser.ts'
import type { BrowserSession, DisplaySession } from './ports.ts'

// Session resource ownership is independent of WebSocket, Playwright and OS processes.
export class RemoteSession {
  private readonly browser: BrowserSession
  private readonly display: DisplaySession
  private readonly sendMessage: (message: WorkerMessage) => void
  private closed = false
  private closePromise?: Promise<void>
  private startup?: Promise<void>
  private actions = Promise.resolve()

  constructor(dependencies: {
    browser: BrowserSession
    display: DisplaySession
    sendMessage: (message: WorkerMessage) => void
  }) {
    this.browser = dependencies.browser
    this.display = dependencies.display
    this.sendMessage = dependencies.sendMessage
  }

  start(displayReady: () => void): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.startup ??= this.startResources(displayReady)
    return this.startup
  }

  private async startResources(displayReady: () => void): Promise<void> {
    try {
      await this.display.start()
      if (this.closed) return
      displayReady()
      await this.browser.start()
      if (!this.closed && !this.display.japaneseImeReady) {
        this.sendMessage({ type: 'error', message: '日本語 IME を起動できませんでした。画面の操作はできます。Worker のログを確認してください。' })
      }
    } catch (error) {
      await this.close()
      throw error
    } finally {
      // A display may finish acquiring resources after close() has already run.
      if (this.closed) this.display.close()
    }
  }

  execute(command: BrowserCommand): Promise<void> {
    this.actions = this.actions.then(async () => {
      if (!this.closed) await this.browser.execute(command)
    }).catch((error: unknown) => {
      if (!this.closed) {
        this.sendMessage({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました' })
      }
    })
    return this.actions
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    // Reach the browser immediately: waiting on startup here can deadlock.
    this.closePromise = Promise.resolve().then(() => this.browser.close()).finally(() => this.display.close())
    return this.closePromise
  }
}
