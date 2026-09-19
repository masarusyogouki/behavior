import { randomUUID } from "node:crypto";
import {
  MAX_JSON_MESSAGE_BYTES,
  VIEWPORT,
  clientMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@behavior/protocol";
import type { BrowserContext, Page } from "playwright";
import { WebSocket } from "ws";

export class RemoteSession {
  readonly id = randomUUID();
  readonly #context: BrowserContext;
  readonly #socket: WebSocket;
  #page: Page | undefined;
  #closed = false;
  #loading = false;
  #history: string[] = [];
  #historyIndex = -1;
  #historyTraversal = false;
  #operation = Promise.resolve();

  constructor(context: BrowserContext, socket: WebSocket) {
    this.#context = context;
    this.#socket = socket;
  }

  async start(): Promise<void> {
    const page = await this.#context.newPage();
    this.#page = page;
    page.on("load", () => {
      this.#loading = false;
      void this.#sendPageState();
    });
    page.on("domcontentloaded", () => void this.#sendPageState());
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.#recordNavigation(frame.url());
      void this.#sendPageState();
    });
    page.on("close", () => void this.close());

    this.#socket.on("message", (data, isBinary) => {
      this.#operation = this.#operation
        .then(() => this.#handleRawMessage(data, isBinary))
        .catch((error: unknown) => this.#sendError("command_failed", String(error), true));
    });
    this.#socket.once("close", () => void this.close());
    this.#socket.once("error", (error) => {
      console.warn(JSON.stringify({ event: "websocket_error", sessionId: this.id, error: error.message }));
    });

    this.#send({ type: "sessionReady", viewport: VIEWPORT });
    await this.#sendPageState();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#context.close().catch(() => undefined);
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
      this.#socket.close();
    }
    console.info(JSON.stringify({ event: "session_closed", sessionId: this.id }));
  }

  async #handleRawMessage(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Promise<void> {
    if (isBinary) {
      this.#sendError("binary_input_not_supported", "Client commands must be JSON text", true);
      return;
    }
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : data;
    if (buffer.byteLength > MAX_JSON_MESSAGE_BYTES) {
      this.#sendError("message_too_large", "Command exceeds the maximum JSON size", true);
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(buffer.toString("utf8"));
    } catch {
      this.#sendError("invalid_json", "Command is not valid JSON", true);
      return;
    }
    const parsed = clientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.#sendError("invalid_command", "Command does not match the remote browser protocol", true);
      return;
    }
    await this.#handleMessage(parsed.data);
  }

  async #handleMessage(message: ClientMessage): Promise<void> {
    const page = this.#page;
    if (!page) throw new Error("Page is not ready");

    switch (message.type) {
      case "navigate":
        this.#loading = true;
        await this.#sendPageState();
        await page.goto(message.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        break;
      case "goBack":
        this.#historyTraversal = true;
        try {
          const previousUrl = page.url();
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
          if (page.url() !== previousUrl) this.#historyIndex = Math.max(0, this.#historyIndex - 1);
        } finally {
          this.#historyTraversal = false;
        }
        break;
      case "goForward":
        this.#historyTraversal = true;
        try {
          const previousUrl = page.url();
          await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 });
          if (page.url() !== previousUrl) {
            this.#historyIndex = Math.min(this.#history.length - 1, this.#historyIndex + 1);
          }
        } finally {
          this.#historyTraversal = false;
        }
        break;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        break;
      case "stopLoading":
        await page.evaluate("window.stop()");
        this.#loading = false;
        break;
      default:
        this.#sendError("unsupported_command", "Input forwarding is not available yet", true);
    }
    await this.#sendPageState();
  }

  #recordNavigation(url: string): void {
    if (this.#historyTraversal || url === "about:blank" || this.#history[this.#historyIndex] === url) return;
    this.#history.splice(this.#historyIndex + 1);
    this.#history.push(url);
    this.#historyIndex = this.#history.length - 1;
  }

  async #sendPageState(): Promise<void> {
    const page = this.#page;
    if (!page || page.isClosed()) return;
    const title = await page.title().catch(() => "");
    this.#send({
      type: "pageState",
      url: page.url(),
      title,
      loading: this.#loading,
      canGoBack: this.#historyIndex > 0,
      canGoForward: this.#historyIndex >= 0 && this.#historyIndex < this.#history.length - 1,
    });
  }

  #send(message: ServerMessage): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  #sendError(code: string, message: string, recoverable: boolean): void {
    this.#send({ type: "error", code, message, recoverable });
  }
}
