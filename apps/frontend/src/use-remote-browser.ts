import { useCallback, useEffect, useRef, useState } from "react";
import { VIEWPORT, parseServerMessage, type ClientMessage, type ServerMessage } from "@behavior/protocol";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const initialPageState: Extract<ServerMessage, { type: "pageState" }> = {
  type: "pageState",
  url: "about:blank",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

function defaultWebSocketUrl(): string {
  if (import.meta.env.VITE_WS_URL) return String(import.meta.env.VITE_WS_URL);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3001/ws`;
}

export function useRemoteBrowser(onFrame: (frame: ArrayBuffer) => void) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [pageState, setPageState] = useState(initialPageState);
  const [error, setError] = useState<string | undefined>();
  const [viewport, setViewport] = useState(VIEWPORT);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      const socket = new WebSocket(defaultWebSocketUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        setError(undefined);
        setStatus("connected");
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          onFrameRef.current(event.data);
          return;
        }
        try {
          const message = parseServerMessage(JSON.parse(String(event.data)));
          if (message.type === "sessionReady") setViewport(message.viewport);
          if (message.type === "pageState") setPageState(message);
          if (message.type === "error") setError(message.message);
        } catch {
          setError("The backend returned an invalid message.");
        }
      };
      socket.onerror = () => setStatus("error");
      socket.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        setPageState(initialPageState);
        reconnectAttempt += 1;
        const delay = Math.min(1_000 * 2 ** (reconnectAttempt - 1), 10_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = undefined;
    };
  }, []);

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return { status, pageState, error, viewport, send };
}
