import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMessage } from "@behavior/protocol";
import { startServer, type RunningServer } from "./server.js";

const browserDescribe = process.env.RUN_BROWSER_INTEGRATION === "1" ? describe : describe.skip;

class MessageCollector {
  readonly json: ServerMessage[] = [];
  readonly binary: Buffer[] = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) this.binary.push(Buffer.from(data as Buffer));
      else this.json.push(JSON.parse(data.toString()) as ServerMessage);
    });
  }

  async waitForJson(predicate: (message: ServerMessage) => boolean, timeout = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const message = this.json.find(predicate);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timed out waiting for a JSON WebSocket message");
  }

  async waitForBinary(timeout = 10_000): Promise<Buffer> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const frame = this.binary.at(-1);
      if (frame) return frame;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timed out waiting for a binary WebSocket message");
  }
}

browserDescribe("remote browser integration", () => {
  let server: RunningServer;
  let port: number;
  let socket: WebSocket;
  let messages: MessageCollector;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
    port = (server.httpServer.address() as AddressInfo).port;
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    messages = new MessageCollector(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await messages.waitForJson((message) => message.type === "sessionReady");
  }, 30_000);

  afterAll(async () => {
    socket?.close();
    await server?.close();
  });

  it("streams JPEG frames and forwards navigation, click, text, key, and scroll", async () => {
    socket.send(JSON.stringify({ type: "navigate", url: `http://127.0.0.1:${port}/__test__/interaction` }));
    await messages.waitForJson(
      (message) => message.type === "pageState" && message.url.includes("/__test__/interaction"),
    );

    const frame = await messages.waitForBinary();
    expect([...frame.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    socket.send(JSON.stringify({ type: "click", x: 100, y: 42, button: "left" }));
    await messages.waitForJson(
      (message) => message.type === "pageState" && message.url.endsWith("#clicked-1"),
    );

    socket.send(JSON.stringify({ type: "click", x: 100, y: 112, button: "left" }));
    socket.send(JSON.stringify({ type: "insertText", text: "hello" }));
    socket.send(JSON.stringify({ type: "pressKey", key: "Enter", modifiers: [] }));
    await messages.waitForJson(
      (message) => message.type === "pageState" && message.url.endsWith("#input-hello"),
    );

    socket.send(JSON.stringify({ type: "scroll", x: 400, y: 400, deltaX: 0, deltaY: 500 }));
    await messages.waitForJson(
      (message) => message.type === "pageState" && message.url.includes("#scroll-"),
    );
  }, 30_000);
});
