export type MouseButton = 'left' | 'middle' | 'right'

type Point = { x: number; y: number }

export type BrowserCommand =
  | ({ type: 'move' } & Point)
  | ({ type: 'down' | 'up'; button: MouseButton } & Point)
  | ({ type: 'wheel'; deltaX: number; deltaY: number } & Point)
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' | 'forward' | 'reload' }

export type WorkerMessage =
  | { type: 'ready'; url: string; fps: string }
  | { type: 'url'; url: string }
  | { type: 'error'; message: string }

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
      return { type: value.type }
    default:
      return null
  }
}
