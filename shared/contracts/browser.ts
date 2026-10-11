export type MouseButton = 'left' | 'middle' | 'right'

type Point = { x: number; y: number }

export type BrowserCommand =
  | ({ type: 'move' } & Point)
  | ({ type: 'down' | 'up'; button: MouseButton } & Point)
  | ({ type: 'wheel'; deltaX: number; deltaY: number } & Point)
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'navigate'; url: string }
  | { type: 'disconnect' }
  | { type: 'back' | 'forward' | 'reload' }

export type ElementSelector = {
  type: 'testId' | 'id' | 'role' | 'label' | 'placeholder' | 'css'
  value: string
  playwright: string
  unique: boolean
}

export type ElementSnapshot = {
  tagName: string
  outerHTML: string
  outerHTMLTruncated: boolean
  text: string
  attributes: Array<{ name: string; value: string }>
  selectors: ElementSelector[]
  frame: {
    url: string
    name: string | null
    isMainFrame: boolean
  }
}

export type WorkerMessage =
  | { type: 'ready'; url: string; vncPath: string }
  | { type: 'url'; url: string }
  | { type: 'element-selected'; element: ElementSnapshot }
  | { type: 'error'; message: string }

// Untrusted messages cross this contract before they reach the React view.
export function parseWorkerMessage(raw: string): WorkerMessage | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!record(value)) return null
  switch (value.type) {
    case 'ready':
      return typeof value.url === 'string' && typeof value.vncPath === 'string'
        ? { type: 'ready', url: value.url, vncPath: value.vncPath }
        : null
    case 'url':
      return typeof value.url === 'string' ? { type: 'url', url: value.url } : null
    case 'error':
      return typeof value.message === 'string' ? { type: 'error', message: value.message } : null
    case 'element-selected':
      return isElementSnapshot(value.element) ? { type: 'element-selected', element: value.element } : null
    default:
      return null
  }
}

function isElementSnapshot(value: unknown): value is ElementSnapshot {
  if (!record(value) || typeof value.tagName !== 'string' || typeof value.outerHTML !== 'string'
    || typeof value.outerHTMLTruncated !== 'boolean' || typeof value.text !== 'string'
    || !Array.isArray(value.attributes) || !Array.isArray(value.selectors) || !record(value.frame)) return false
  const frame = value.frame
  const selectorTypes: ElementSelector['type'][] = ['testId', 'id', 'role', 'label', 'placeholder', 'css']
  return typeof frame.url === 'string' && (frame.name === null || typeof frame.name === 'string')
    && typeof frame.isMainFrame === 'boolean'
    && value.attributes.every((attribute: unknown) => record(attribute)
      && typeof attribute.name === 'string' && typeof attribute.value === 'string')
    && value.selectors.every((selector: unknown) => record(selector)
      && selectorTypes.includes(selector.type as ElementSelector['type'])
      && typeof selector.value === 'string' && typeof selector.playwright === 'string'
      && typeof selector.unique === 'boolean')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function point(value: Record<string, unknown>, width: number, height: number): value is Record<string, unknown> & Point {
  return finiteNumber(value.x) && finiteNumber(value.y)
    && value.x >= 0 && value.x < width && value.y >= 0 && value.y < height
}

// 形式が合わない操作は無視する。JSON 自体が壊れている場合は呼び出し元へ例外を返す。
export function parseCommand(raw: string, width: number, height: number): BrowserCommand | null {
  const value: unknown = JSON.parse(raw)
  if (!record(value)) return null

  switch (value.type) {
    case 'move':
      return point(value, width, height) ? { type: 'move', x: value.x, y: value.y } : null
    case 'down':
    case 'up':
      return point(value, width, height) && (value.button === 'left' || value.button === 'middle' || value.button === 'right')
        ? { type: value.type, x: value.x, y: value.y, button: value.button }
        : null
    case 'wheel':
      return point(value, width, height) && finiteNumber(value.deltaX) && finiteNumber(value.deltaY)
        ? { type: 'wheel', x: value.x, y: value.y, deltaX: value.deltaX, deltaY: value.deltaY }
        : null
    case 'key':
      return typeof value.key === 'string' && value.key.length <= 100
        ? { type: 'key', key: value.key }
        : null
    case 'text':
      return typeof value.text === 'string' && value.text.length <= 1000
        ? { type: 'text', text: value.text }
        : null
    case 'navigate':
      return typeof value.url === 'string' ? { type: 'navigate', url: value.url } : null
    case 'back':
    case 'forward':
    case 'reload':
    case 'disconnect':
      return { type: value.type }
    default:
      return null
  }
}
