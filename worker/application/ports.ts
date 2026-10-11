import type { BrowserCommand } from '../../shared/contracts/browser.ts'

export interface BrowserSession {
  start(): Promise<void>
  execute(command: BrowserCommand): Promise<void>
  close(): Promise<void>
}

export interface DisplaySession {
  start(): Promise<void>
  close(): void
  readonly japaneseImeReady: boolean
}
