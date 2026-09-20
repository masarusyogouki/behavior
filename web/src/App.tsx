import { useEffect, useRef, useState } from 'react'
import './App.css'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    return () => {
      const ws = socketRef.current
      socketRef.current = null
      ws?.close()
    }
  }, [])

  const connect = () => {
    if (socketRef.current) return

    const ws = new WebSocket('ws://127.0.0.1:3000')
    socketRef.current = ws
    ws.binaryType = 'blob'
    let isDrawing = false
    setStatus('connecting')

    ws.onopen = () => {
      if (socketRef.current === ws) setStatus('connected')
    }
    ws.onerror = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      setStatus('error')
      ws.close()
    }
    ws.onclose = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      setStatus('disconnected')
    }
    ws.onmessage = async (event: MessageEvent<Blob>) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (socketRef.current !== ws || !canvas || !ctx || isDrawing) return

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
    ws?.close()
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setStatus('disconnected')
  }

  const statusText = {
    disconnected: '未接続',
    connecting: '接続中…',
    connected: '接続済み',
    error: '接続エラー',
  }[status]

  return (
    <main className="viewer">
      <h1>Browser</h1>
      <div className="viewer-controls">
        <p role="status">{statusText} · 5 FPS</p>
        <button type="button" onClick={connect} disabled={status === 'connecting' || status === 'connected'}>
          接続
        </button>
        <button type="button" onClick={disconnect} disabled={status !== 'connecting' && status !== 'connected'}>
          切断
        </button>
      </div>
      <div className="viewer-screen">
        <canvas ref={canvasRef} width={1280} height={720} aria-label="ブラウザー画面" />
        {status !== 'connected' && <span className="viewer-placeholder">接続すると画面が表示されます</span>}
      </div>
    </main>
  )
}

export default App
