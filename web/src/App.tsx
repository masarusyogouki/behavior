'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type EnvironmentState = 'queued' | 'building' | 'tunnel_waiting' | 'ready' | 'stopped' | 'failed'
type EnvironmentStatusResponse = {
  sessionId: string
  state: EnvironmentState
  websocketUrl?: string
  token?: string
  message?: string
}
type ElementSnapshot = {
  tagName: string
  outerHTML: string
  outerHTMLTruncated: boolean
  text: string
  attributes: Array<{ name: string; value: string }>
  selectors: Array<{
    type: 'testId' | 'id' | 'role' | 'label' | 'placeholder' | 'css'
    value: string
    playwright: string
    unique: boolean
  }>
  frame: { url: string; name: string | null; isMainFrame: boolean }
}

type WorkerMessage = {
  type: string
  vncPath?: string
  message?: string
  element?: ElementSnapshot
}

type RemoteFrame = {
  disconnect(): void
  scaleViewport: boolean
  focusOnClick: boolean
  focus(options?: FocusOptions): void
  sendKey(keysym: number, code: string): void
  addEventListener(type: string, listener: EventListener): void
}

// ローカル IME が key="Process" を返すと noVNC は keysym を決められない。
// そのときだけ物理キーをローマ字入力用のキーとして遠隔 IME に送る。
function physicalKeysym(code: string, shift: boolean): number | null {
  if (/^Key[A-Z]$/.test(code)) return (shift ? 65 : 97) + code.charCodeAt(3) - 65
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5)
  const keys: Record<string, number> = {
    Space: 0x20,
    Enter: 0xff0d,
    NumpadEnter: 0xff0d,
    Backspace: 0xff08,
    Escape: 0xff1b,
    Delete: 0xffff,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
  }
  return keys[code] ?? null
}

function App() {
  const screenRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const rfbRef = useRef<RemoteFrame | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [environmentState, setEnvironmentState] = useState<EnvironmentState | null>(null)
  const [notice, setNotice] = useState('')
  const [selectedElement, setSelectedElement] = useState<ElementSnapshot | null>(null)

  useEffect(() => () => {
    pollAbortRef.current?.abort()
    rfbRef.current?.disconnect()
    socketRef.current?.close()
  }, [])

  const disconnect = () => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
    const ws = socketRef.current
    socketRef.current = null
    rfbRef.current?.disconnect()
    rfbRef.current = null
    if (ws?.readyState === WebSocket.OPEN) {
      // 明示切断をWorkerへ伝え、GitHub Actionsのsessionを正常終了させる。
      ws.send(JSON.stringify({ type: 'disconnect' }))
      window.setTimeout(() => ws.close(), 1000)
    } else {
      ws?.close()
    }
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    window.localStorage.removeItem('behavior.sessionId')
    if (sessionId) {
      void fetch(`/api/environments/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
        .catch(() => undefined)
    }
    setStatus('disconnected')
    setEnvironmentState(null)
    setNotice('')
  }

  const connectWorker = (workerUrl: string, token?: string) => {
    let ws: WebSocket
    try {
      ws = token
        ? new WebSocket(workerUrl, ['behavior.v1', `behavior.jwt.${token}`])
        : new WebSocket(workerUrl)
    } catch {
      setNotice('WebSocket の接続先 URL が無効です。')
      setStatus('error')
      return
    }
    socketRef.current = ws
    setStatus('connecting')
    setNotice('')
    ws.onerror = () => {
      if (socketRef.current !== ws) return
      setStatus('error')
      setNotice('サーバーに接続できませんでした')
    }
    ws.onclose = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      rfbRef.current?.disconnect()
      rfbRef.current = null
      setStatus('disconnected')
      setEnvironmentState('stopped')
      sessionIdRef.current = null
      window.localStorage.removeItem('behavior.sessionId')
    }
    ws.onmessage = async (event: MessageEvent<string>) => {
      if (socketRef.current !== ws) return
      let message: WorkerMessage
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'error') setNotice(message.message ?? 'エラーが発生しました')
      if (message.type === 'element-selected' && message.element) {
        setSelectedElement(message.element)
        return
      }
      if (message.type !== 'ready' || !message.vncPath || !screenRef.current) return
      try {
        // 操作接続で受け取った一時パスを、同じ Worker の画面接続に使う。
        const { default: RFB } = await import('@novnc/novnc')
        if (socketRef.current !== ws || !screenRef.current) return
        const vncUrl = new URL(workerUrl)
        vncUrl.pathname = message.vncPath
        vncUrl.search = ''
        const rfb = new RFB(screenRef.current, vncUrl.href) as RemoteFrame
        rfb.scaleViewport = true
        rfb.focusOnClick = true
        rfb.addEventListener('connect', () => { if (socketRef.current === ws) setStatus('connected') })
        rfb.addEventListener('disconnect', () => {
          if (socketRef.current === ws) {
            setNotice('VNC 接続が切断されました')
            ws.close()
          }
        })
        rfbRef.current = rfb
      } catch (error) {
        console.error('VNC 接続エラー:', error)
        setNotice('VNC 画面を開けませんでした')
        ws.close()
      }
    }
  }

  const waitForEnvironment = async (sessionId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      const response = await fetch(`/api/environments/${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
        signal,
      })
      const body: EnvironmentStatusResponse | { message?: string } = await response.json()
      if (!response.ok) throw new Error(body.message ?? '環境の状態を取得できませんでした。')
      const environment = body as EnvironmentStatusResponse
      setEnvironmentState(environment.state)
      if (environment.state === 'ready') {
        if (!environment.websocketUrl || !environment.token) throw new Error('接続情報が不足しています。')
        connectWorker(environment.websocketUrl, environment.token)
        return
      }
      if (environment.state === 'failed' || environment.state === 'stopped') {
        throw new Error(environment.message ?? '環境が停止しました。')
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          window.clearTimeout(timeout)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        const timeout = window.setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, 3000)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }

  const connect = async () => {
    if (socketRef.current || pollAbortRef.current) return
    setStatus('connecting')
    setNotice('')

    const localDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    const directWorkerUrl = localDevelopment
      ? process.env.NEXT_PUBLIC_WORKER_WS_URL || 'ws://127.0.0.1:3000'
      : ''
    if (directWorkerUrl) {
      connectWorker(directWorkerUrl)
      return
    }

    const controller = new AbortController()
    pollAbortRef.current = controller
    try {
      let sessionId = window.localStorage.getItem('behavior.sessionId')
      if (!sessionId) {
        const response = await fetch('/api/environments', { method: 'POST', signal: controller.signal })
        const body: { sessionId?: string; message?: string } = await response.json()
        if (!response.ok || !body.sessionId) throw new Error(body.message ?? '環境を起動できませんでした。')
        sessionId = body.sessionId
        window.localStorage.setItem('behavior.sessionId', sessionId)
      }
      sessionIdRef.current = sessionId
      setEnvironmentState('queued')
      await waitForEnvironment(sessionId, controller.signal)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStatus('error')
      setEnvironmentState('failed')
      setNotice(error instanceof Error ? error.message : '環境を起動できませんでした。')
      sessionIdRef.current = null
      window.localStorage.removeItem('behavior.sessionId')
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null
    }
  }

  const focusScreen = (event: MouseEvent<HTMLDivElement>) => {
    // noVNC が描いた canvas をクリックした後、キーボード入力先を遠隔画面にする。
    if (event.target instanceof HTMLCanvasElement) rfbRef.current?.focus({ preventScroll: true })
  }

  const keyScreen = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLCanvasElement)) return
    const native = event.nativeEvent
    // 通常のキーは noVNC に任せ、ローカル IME が横取りしたキーだけ補う。
    if (!native.isComposing && native.keyCode !== 229 && event.key !== 'Process' && event.key !== 'Unidentified') return
    const keysym = physicalKeysym(event.code, event.shiftKey)
    if (keysym === null) return
    event.preventDefault()
    event.stopPropagation()
    rfbRef.current?.sendKey(keysym, event.code)
  }

  const connected = status === 'connected'
  const launchStatusText: Record<EnvironmentState, string> = {
    queued: 'runner待ち…',
    building: 'Workerビルド中…',
    tunnel_waiting: 'Tunnel起動中…',
    ready: '接続中…',
    stopped: '停止済み',
    failed: '起動エラー',
  }
  const statusText = environmentState && status !== 'connected'
    ? launchStatusText[environmentState]
    : { disconnected: '未接続', connecting: '接続中…', connected: '接続済み', error: '接続エラー' }[status]
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).catch(() => setNotice('クリップボードへコピーできませんでした'))
  }
  return (
    <main className="viewer">
      <header className="viewer-header">
        <div className="viewer-heading">
          <span className="viewer-heading-mark" aria-hidden="true">◈</span>
          <div><span className="viewer-eyebrow">REMOTE SESSION</span><h1>Browser</h1></div>
        </div>
        <div className="viewer-controls">
          <p className={`viewer-status viewer-status-${status}`} role="status"><span className="viewer-status-dot" aria-hidden="true" />{statusText}</p>
          <button className="viewer-connect" type="button" onClick={() => void connect()} disabled={status === 'connecting' || connected}>環境を立ち上げる</button>
          <button className="viewer-disconnect" type="button" onClick={disconnect} disabled={status !== 'connecting' && !connected}>切断</button>
        </div>
      </header>
      <div className="viewer-workspace">
        <div className="viewer-browser-column">
          <section className="browser-window" aria-label="リモートブラウザー">
            <div className="viewer-screen" onMouseDownCapture={focusScreen} onKeyDownCapture={keyScreen}>
              <div ref={screenRef} className="vnc-screen" aria-label="ブラウザー画面" />
              {!connected && <div className="viewer-placeholder"><span className="viewer-placeholder-icon" aria-hidden="true">◈</span><strong>{status === 'connecting' ? 'ブラウザーを起動しています…' : 'ブラウザーは未接続です'}</strong><span>接続すると Chromium の画面がここに表示されます</span></div>}
            </div>
          </section>
          {connected && <p className="viewer-input-hint">画面をクリックして入力。クリックした要素の情報は右側に表示されます。日本語入力は Ctrl+Space で切り替えます。</p>}
        </div>
        <aside className="element-panel" aria-label="クリックした要素の詳細">
          <div className="element-panel-header">
            <div><span className="viewer-eyebrow">ELEMENT INSPECTOR</span><h2>クリックした要素</h2></div>
            {selectedElement && <span className="element-tag">{selectedElement.tagName}</span>}
          </div>
          {!selectedElement ? (
            <div className="element-empty"><strong>まだ要素が選択されていません</strong><span>Chromium 内の要素をクリックすると、DOMとセレクタ候補を表示します。</span></div>
          ) : (
            <div className="element-details">
              <section className="element-section">
                <h3>フレーム</h3>
                <p className="element-frame-url" title={selectedElement.frame.url}>{selectedElement.frame.url}</p>
                <p className="element-meta">{selectedElement.frame.isMainFrame ? 'メインフレーム' : `iframe${selectedElement.frame.name ? `: ${selectedElement.frame.name}` : ''}`}</p>
              </section>
              {selectedElement.text && <section className="element-section"><h3>テキスト</h3><p className="element-text">{selectedElement.text}</p></section>}
              <section className="element-section">
                <h3>セレクタ候補</h3>
                {selectedElement.selectors.length === 0 ? <p className="element-meta">候補を生成できませんでした。</p> : (
                  <div className="selector-list">{selectedElement.selectors.map((selector, index) => (
                    <div className="selector-item" key={`${selector.type}-${selector.value}-${index}`}>
                      <div className="selector-heading"><span>{selector.type}</span><span className={selector.unique ? 'selector-unique' : 'selector-duplicate'}>{selector.unique ? '一意' : '複数一致'}</span></div>
                      <code>{selector.playwright}</code>
                      <button type="button" onClick={() => copy(selector.playwright)}>コピー</button>
                    </div>
                  ))}</div>
                )}
              </section>
              <section className="element-section">
                <h3>属性</h3>
                {selectedElement.attributes.length === 0 ? <p className="element-meta">属性はありません。</p> : (
                  <dl className="attribute-list">{selectedElement.attributes.map((attribute) => (
                    <div key={attribute.name}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></div>
                  ))}</dl>
                )}
              </section>
              <section className="element-section">
                <div className="element-section-heading"><h3>DOM</h3><button type="button" onClick={() => copy(selectedElement.outerHTML)}>コピー</button></div>
                <pre className="element-dom"><code>{selectedElement.outerHTML}</code></pre>
                {selectedElement.outerHTMLTruncated && <p className="element-meta">長いDOMのため、途中まで表示しています。</p>}
              </section>
            </div>
          )}
        </aside>
      </div>
      {notice && <p className="viewer-notice" role="alert">{notice}</p>}
    </main>
  )
}

export default App
