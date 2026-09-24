'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
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
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [notice, setNotice] = useState('')

  useEffect(() => () => {
    rfbRef.current?.disconnect()
    socketRef.current?.close()
  }, [])

  const disconnect = () => {
    const ws = socketRef.current
    socketRef.current = null
    rfbRef.current?.disconnect()
    rfbRef.current = null
    ws?.close()
    setStatus('disconnected')
    setNotice('')
  }

  const connect = () => {
    if (socketRef.current) return
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_WS_URL
      || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'ws://127.0.0.1:3000' : '')
    if (!workerUrl) {
      setNotice('接続先が未設定です。NEXT_PUBLIC_WORKER_WS_URL を設定してください。')
      return
    }
    let ws: WebSocket
    try { ws = new WebSocket(workerUrl) } catch {
      setNotice('WebSocket の接続先 URL が無効です。')
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
    }
    ws.onmessage = async (event: MessageEvent<string>) => {
      if (socketRef.current !== ws) return
      let message: { type: string; vncPath?: string; message?: string }
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'error') setNotice(message.message ?? 'エラーが発生しました')
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
  const statusText = { disconnected: '未接続', connecting: '接続中…', connected: '接続済み', error: '接続エラー' }[status]
  return (
    <main className="viewer">
      <header className="viewer-header">
        <div className="viewer-heading">
          <span className="viewer-heading-mark" aria-hidden="true">◈</span>
          <div><span className="viewer-eyebrow">REMOTE SESSION</span><h1>Browser</h1></div>
        </div>
        <div className="viewer-controls">
          <p className={`viewer-status viewer-status-${status}`} role="status"><span className="viewer-status-dot" aria-hidden="true" />{statusText}</p>
          <button className="viewer-connect" type="button" onClick={connect} disabled={status === 'connecting' || connected}>接続</button>
          <button className="viewer-disconnect" type="button" onClick={disconnect} disabled={status !== 'connecting' && !connected}>切断</button>
        </div>
      </header>
      <section className="browser-window" aria-label="リモートブラウザー">
        <div className="viewer-screen" onMouseDownCapture={focusScreen} onKeyDownCapture={keyScreen}>
          <div ref={screenRef} className="vnc-screen" aria-label="ブラウザー画面" />
          {!connected && <div className="viewer-placeholder"><span className="viewer-placeholder-icon" aria-hidden="true">◈</span><strong>{status === 'connecting' ? 'ブラウザーを起動しています…' : 'ブラウザーは未接続です'}</strong><span>接続すると Chromium の画面がここに表示されます</span></div>}
        </div>
      </section>
      {connected && <p className="viewer-input-hint">画面をクリックして入力。日本語入力は Ctrl+Space で切り替えます。手元の IME はオフにしてください。</p>}
      {notice && <p className="viewer-notice" role="alert">{notice}</p>}
    </main>
  )
}

export default App
