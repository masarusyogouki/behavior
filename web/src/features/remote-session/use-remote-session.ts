'use client'

import { useEffect, useRef, useState } from 'react'
import { parseWorkerMessage } from '../../../../shared/contracts/browser.ts'
import type { ElementSnapshot } from '../../../../shared/contracts/browser.ts'
import type { EnvironmentState, EnvironmentStatus as EnvironmentStatusResponse } from '../../../../shared/contracts/environment.ts'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type RemoteFrame = {
  disconnect(): void
  scaleViewport: boolean
  focusOnClick: boolean
  focus(options?: FocusOptions): void
  sendKey(keysym: number, code: string): void
  addEventListener(type: string, listener: EventListener): void
}


export function useRemoteSession() {
  const screenRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const rfbRef = useRef<RemoteFrame | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [environmentState, setEnvironmentState] = useState<EnvironmentState | null>(null)
  const [notice, setNotice] = useState('')
  const [selectedElement, setSelectedElement] = useState<ElementSnapshot | null>(null)
  const [accessKey, setAccessKey] = useState('')

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
      const message = parseWorkerMessage(event.data)
      if (!message) return
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

    const controller = new AbortController()
    pollAbortRef.current = controller
    try {
      if (accessKey) {
        const login = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey }), signal: controller.signal,
        })
        if (!login.ok) {
          const body = await login.json() as { message?: string }
          throw new Error(body.message ?? '認証に失敗しました。')
        }
        setAccessKey('')
      }
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

  return { screenRef, rfbRef, status, environmentState, notice, setNotice, selectedElement, accessKey, setAccessKey, connect, disconnect }
}
