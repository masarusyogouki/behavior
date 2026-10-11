'use client'

import { useRemoteSession } from './features/remote-session/use-remote-session'
import type { EnvironmentState } from '../../shared/contracts/environment.ts'
import type { KeyboardEvent, MouseEvent } from 'react'

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
  const { screenRef, rfbRef, status, environmentState, notice, setNotice, selectedElement, accessKey, setAccessKey, connect, disconnect } = useRemoteSession()

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
          {!connected && <input className="viewer-access-key" type="password" aria-label="アクセスキー" placeholder="アクセスキー（初回）" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} disabled={status === 'connecting'} />}
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
