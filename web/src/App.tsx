'use client'

import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, CompositionEvent, FormEvent, KeyboardEvent, PointerEvent } from 'react'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type BrowserCommand = Record<string, string | number>
type MouseButton = 'left' | 'middle' | 'right'

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(canvas.width - 1, Math.round((clientX - bounds.left) * canvas.width / bounds.width))),
    y: Math.max(0, Math.min(canvas.height - 1, Math.round((clientY - bounds.top) * canvas.height / bounds.height))),
  }
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const socketRef = useRef<WebSocket | null>(null)
  const pressedButtonRef = useRef<MouseButton | null>(null)
  const lastPointerMoveRef = useRef(0)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [fps, setFps] = useState<number | null>(null)
  const [address, setAddress] = useState('https://en.wikipedia.org/wiki/Main_Page')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    return () => {
      const ws = socketRef.current
      socketRef.current = null
      ws?.close()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || status !== 'connected') return

    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      const ws = socketRef.current
      if (ws?.readyState !== WebSocket.OPEN) return

      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.height : 1
      ws.send(JSON.stringify({
        type: 'wheel',
        ...canvasPoint(canvas, event.clientX, event.clientY),
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
      }))
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [status])

  const sendCommand = (command: BrowserCommand) => {
    const ws = socketRef.current
    if (ws?.readyState === WebSocket.OPEN && status === 'connected') {
      ws.send(JSON.stringify(command))
    }
  }

  const clearScreen = () => {
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  const connect = () => {
    if (socketRef.current) return

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_WS_URL
      || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'ws://127.0.0.1:3000' : '')
    if (!workerUrl) {
      setNotice('接続先が未設定です。NEXT_PUBLIC_WORKER_WS_URL を設定してください。')
      return
    }
    if (window.location.protocol === 'https:' && !workerUrl.startsWith('wss://')) {
      setNotice('HTTPS では wss:// の接続先を設定してください。')
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(workerUrl)
    } catch {
      setNotice('WebSocket の接続先 URL が無効です。')
      return
    }
    socketRef.current = ws
    ws.binaryType = 'blob'
    let isDrawing = false
    setStatus('connecting')
    setFps(null)
    setNotice('')

    ws.onerror = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      setStatus('error')
      setFps(null)
      setNotice('サーバーに接続できませんでした')
      clearScreen()
      ws.close()
    }
    ws.onclose = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      setStatus('disconnected')
      setFps(null)
      clearScreen()
    }
    ws.onmessage = async (event: MessageEvent<Blob | string>) => {
      if (socketRef.current !== ws) return

      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data) as Record<string, string>
          if (message.type === 'ready') {
            setAddress(message.url)
            const reportedFps = Number(message.fps)
            if (Number.isFinite(reportedFps)) setFps(reportedFps)
            setStatus('connected')
          } else if (message.type === 'url') {
            setAddress(message.url)
          } else if (message.type === 'error') {
            setNotice(message.message)
          }
        } catch (error) {
          console.error('サーバー応答を読み取れませんでした:', error)
        }
        return
      }

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx || isDrawing) return

      isDrawing = true
      try {
        const bitmap = await createImageBitmap(event.data)
        try {
          if (socketRef.current === ws) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          }
        } finally {
          bitmap.close()
        }
      } catch (error) {
        console.error('画像の描画に失敗しました:', error)
      } finally {
        isDrawing = false
      }
    }
  }

  const disconnect = () => {
    const ws = socketRef.current
    socketRef.current = null
    pressedButtonRef.current = null
    composingRef.current = false
    if (inputRef.current) inputRef.current.value = ''
    ws?.close()
    clearScreen()
    setStatus('disconnected')
    setFps(null)
    setNotice('')
  }

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!['0', '1', '2'].includes(String(event.button))) return
    event.preventDefault()
    const input = inputRef.current
    if (input) {
      const screen = input.parentElement?.getBoundingClientRect()
      if (screen) {
        input.style.left = `${event.clientX - screen.left}px`
        input.style.top = `${event.clientY - screen.top}px`
      }
      input.focus()
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const button: MouseButton = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left'
    pressedButtonRef.current = button
    sendCommand({ type: 'down', ...canvasPoint(event.currentTarget, event.clientX, event.clientY), button })
  }

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (Date.now() - lastPointerMoveRef.current < 50) return
    lastPointerMoveRef.current = Date.now()
    sendCommand({ type: 'move', ...canvasPoint(event.currentTarget, event.clientX, event.clientY) })
  }

  const pointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const button = pressedButtonRef.current
    if (!button) return
    pressedButtonRef.current = null
    sendCommand({ type: 'up', ...canvasPoint(event.currentTarget, event.clientX, event.clientY), button })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const keyScreen = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229 || event.key === 'Process' || event.key === 'Dead') return
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') return
    if (['Convert', 'NonConvert', 'KanaMode', 'Lang1', 'Lang2'].includes(event.code)) return
    event.preventDefault()
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    const key = event.code || (event.key === ' ' ? 'Space' : event.key)
    const modifiers = [
      event.ctrlKey && 'Control',
      event.altKey && 'Alt',
      event.metaKey && 'Meta',
      event.shiftKey && 'Shift',
    ].filter(Boolean)
    sendCommand({ type: 'key', key: [...modifiers, key].join('+') })
  }

  const sendText = (text: string) => {
    let chunk = ''
    for (const character of text) {
      if (chunk.length + character.length > 1000) {
        sendCommand({ type: 'text', text: chunk })
        chunk = ''
      }
      chunk += character
    }
    if (chunk) sendCommand({ type: 'text', text: chunk })
  }

  const commitInput = (input: HTMLTextAreaElement) => {
    if (composingRef.current || !input.value) return
    sendText(input.value)
    input.value = ''
  }

  const compositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    // IME によっては確定後の input イベントが発生しない。
    const input = event.currentTarget
    window.setTimeout(() => commitInput(input), 0)
  }

  const pasteInput = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (text) sendText(text)
  }

  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice('')
    sendCommand({ type: 'navigate', url: address })
  }

  const statusText = {
    disconnected: '未接続',
    connecting: '接続中…',
    connected: '接続済み',
    error: '接続エラー',
  }[status]
  const connected = status === 'connected'
  let tabTitle = '新しいタブ'
  try {
    tabTitle = new URL(address).hostname || tabTitle
  } catch {
    // URL 入力中は現在のタブ名を維持する
  }

  return (
    <main className="viewer">
      <header className="viewer-header">
        <div className="viewer-heading">
          <span className="viewer-heading-mark" aria-hidden="true">◈</span>
          <div>
            <span className="viewer-eyebrow">REMOTE SESSION</span>
            <h1>Browser</h1>
          </div>
        </div>
        <div className="viewer-controls">
          <p className={`viewer-status viewer-status-${status}`} role="status">
            <span className="viewer-status-dot" aria-hidden="true" />
            {statusText}{fps !== null && <span className="viewer-fps"> · 設定 {fps} FPS</span>}
          </p>
          <button className="viewer-connect" type="button" onClick={connect} disabled={status === 'connecting' || connected}>接続</button>
          <button className="viewer-disconnect" type="button" onClick={disconnect} disabled={status !== 'connecting' && !connected}>切断</button>
        </div>
      </header>

      <section className="browser-window" aria-label="リモートブラウザー">
        <div className="browser-tabs">
          <div className="browser-window-dots" aria-hidden="true"><span /><span /><span /></div>
          <div className="browser-tab" aria-current="page">
            <span className="browser-tab-icon" aria-hidden="true">◉</span>
            <span className="browser-tab-title">{tabTitle}</span>
          </div>
          <span className="browser-tab-spacer" />
          <span className="browser-session-label">CHROMIUM</span>
        </div>
        <form className="viewer-toolbar" onSubmit={navigate}>
          <div className="browser-navigation">
            <button type="button" disabled={!connected} onClick={() => sendCommand({ type: 'back' })} aria-label="戻る" title="戻る">←</button>
            <button type="button" disabled={!connected} onClick={() => sendCommand({ type: 'forward' })} aria-label="進む" title="進む">→</button>
            <button type="button" disabled={!connected} onClick={() => sendCommand({ type: 'reload' })} aria-label="再読み込み" title="再読み込み">↻</button>
          </div>
          <div className="browser-address">
            <span className="browser-address-icon" aria-hidden="true">⌕</span>
            <input aria-label="URL" value={address} onChange={(event) => setAddress(event.target.value)} disabled={!connected} spellCheck={false} />
          </div>
          <button className="browser-go" type="submit" disabled={!connected}>移動</button>
        </form>
        <div className="viewer-screen">
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            tabIndex={-1}
            aria-label="ブラウザー画面"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onAuxClick={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
          />
          <textarea
            ref={inputRef}
            className="viewer-keyboard-input"
            aria-label="ブラウザー画面への文字入力"
            tabIndex={connected ? 0 : -1}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={keyScreen}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={compositionEnd}
            onInput={(event) => commitInput(event.currentTarget)}
            onPaste={pasteInput}
          />
          {!connected && (
            <div className="viewer-placeholder">
              <span className="viewer-placeholder-icon" aria-hidden="true">◈</span>
              <strong>{status === 'connecting' ? 'ブラウザーを起動しています…' : 'ブラウザーは未接続です'}</strong>
              <span>接続すると Chromium の画面がここに表示されます</span>
            </div>
          )}
        </div>
        <div className="browser-footer">
          <span>1280 × 720</span>
          <span>画面をクリックするとキーボードで操作できます</span>
        </div>
      </section>

      {notice && <p className="viewer-notice" role="alert">{notice}</p>}
    </main>
  )
}

export default App
