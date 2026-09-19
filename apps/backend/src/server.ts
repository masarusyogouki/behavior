import { createServer, type Server as HttpServer } from "node:http";
import { MAX_JSON_MESSAGE_BYTES } from "@behavior/protocol";
import { WebSocketServer } from "ws";
import { BrowserManager } from "./browser-manager.js";
import { RemoteSession } from "./remote-session.js";
import { interactionFixtureHtml } from "./test-fixture.js";

export type RunningServer = { close: () => Promise<void>; httpServer: HttpServer };

export async function startServer({ port }: { port: number }): Promise<RunningServer> {
  const browserManager = new BrowserManager();
  await browserManager.start();
  const sessions = new Set<RemoteSession>();
  const maxSessions = Math.max(1, Number(process.env.MAX_SESSIONS ?? 4));
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim()),
  );
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_JSON_MESSAGE_BYTES });
  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/__test__/interaction" && process.env.NODE_ENV !== "production") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(interactionFixtureHtml);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (sessions.size >= maxSessions) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n");
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });

  webSocketServer.on("connection", async (socket) => {
    let session: RemoteSession | undefined;
    try {
      const context = await browserManager.createContext();
      const activeSession = new RemoteSession(context, socket);
      session = activeSession;
      sessions.add(activeSession);
      socket.once("close", () => sessions.delete(activeSession));
      console.info(JSON.stringify({ event: "session_opened", sessionId: activeSession.id }));
      await activeSession.start();
    } catch (error) {
      console.error(JSON.stringify({ event: "session_start_failed", error: String(error) }));
      await session?.close();
      socket.close(1011, "Unable to start browser session");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  console.info(JSON.stringify({ event: "server_listening", port }));

  return {
    httpServer,
    close: async () => {
      webSocketServer.close();
      await Promise.allSettled([...sessions].map((session) => session.close()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await browserManager.close();
    },
  };
}
