import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CanvasFrameRenderer } from "./frame-renderer";
import { useRemoteBrowser } from "./use-remote-browser";

const statusLabels = {
  connecting: "接続中",
  connected: "接続済み",
  disconnected: "再接続待ち",
  error: "接続エラー",
} as const;

export function RemoteBrowser() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasFrameRenderer | undefined>(undefined);
  const [address, setAddress] = useState("https://example.com");
  const onFrame = useCallback((frame: ArrayBuffer) => rendererRef.current?.push(frame), []);
  const { status, pageState, error, viewport, send } = useRemoteBrowser(onFrame);
  const connected = status === "connected";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasFrameRenderer(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (pageState.url !== "about:blank") setAddress(pageState.url);
  }, [pageState.url]);

  const sendSimpleCommand = (type: "goBack" | "goForward" | "reload" | "stopLoading") => {
    send({ type });
  };

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    let url = address.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (url) send({ type: "navigate", url });
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">PLAYWRIGHT REMOTE VIEW</p><h1>{pageState.title || "Remote Chromium"}</h1></div>
        <span className={`status status--${status}`}><span className="status__dot" aria-hidden="true" />{statusLabels[status]}</span>
      </header>
      <section className="browser" aria-label="Remote browser">
        <div className="toolbar">
          <div className="toolbar__nav">
            <button type="button" onClick={() => sendSimpleCommand("goBack")} disabled={!connected || !pageState.canGoBack} aria-label="戻る">←</button>
            <button type="button" onClick={() => sendSimpleCommand("goForward")} disabled={!connected || !pageState.canGoForward} aria-label="進む">→</button>
            <button type="button" onClick={() => sendSimpleCommand(pageState.loading ? "stopLoading" : "reload")} disabled={!connected} aria-label={pageState.loading ? "読み込み停止" : "再読み込み"}>{pageState.loading ? "×" : "↻"}</button>
          </div>
          <form className="address" onSubmit={navigate}>
            <input value={address} onChange={(event) => setAddress(event.target.value)} disabled={!connected} aria-label="URL" spellCheck={false} />
            <button type="submit" disabled={!connected}>移動</button>
          </form>
        </div>
        <div className="viewport-shell">
          <canvas ref={canvasRef} width={viewport.width} height={viewport.height} aria-label="Chromium screen" />
          {!connected && <div className="viewport-overlay">{statusLabels[status]}</div>}
        </div>
      </section>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <footer>Viewport {viewport.width} × {viewport.height} · JPEG over WebSocket</footer>
    </main>
  );
}
