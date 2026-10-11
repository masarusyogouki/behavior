import type { WorkerMessage } from '../shared/contracts/browser.ts'
import { RemoteSession } from './application/remote-session.ts'
import { PlaywrightSession } from './adapters/playwright/session.ts'
import { VncDisplay } from './adapters/vnc/display.ts'

export function createRemoteSession(sendMessage: (message: WorkerMessage) => void, vncPath: string) {
  const display = new VncDisplay()
  const browser = new PlaywrightSession({ sendMessage, vncPath, environment: () => display.environment })
  return { session: new RemoteSession({ browser, display, sendMessage }), vncPort: display.port }
}
