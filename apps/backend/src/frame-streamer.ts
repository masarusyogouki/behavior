import type { Page } from "playwright";
import { WebSocket } from "ws";
import { VIEWPORT } from "@behavior/protocol";

export const FRAME_INTERVAL_MS = 50;
export const MAX_BUFFERED_FRAME_BYTES = 4 * 1024 * 1024;

export function shouldSendFrame(
  timestamp: number,
  lastSentTimestamp: number,
  bufferedAmount: number,
): boolean {
  return (
    timestamp - lastSentTimestamp >= FRAME_INTERVAL_MS && bufferedAmount <= MAX_BUFFERED_FRAME_BYTES
  );
}

export class FrameStreamer {
  readonly #page: Page;
  readonly #socket: WebSocket;
  #started = false;
  #lastSentTimestamp = Number.NEGATIVE_INFINITY;

  constructor(page: Page, socket: WebSocket) {
    this.#page = page;
    this.#socket = socket;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;

    try {
      await this.#page.screencast.start({
        size: VIEWPORT,
        quality: 70,
        onFrame: ({ data, timestamp }) => {
          if (this.#socket.readyState !== WebSocket.OPEN) return;
          if (!shouldSendFrame(timestamp, this.#lastSentTimestamp, this.#socket.bufferedAmount)) return;
          this.#lastSentTimestamp = timestamp;
          this.#socket.send(data, { binary: true });
        },
      });
    } catch (error) {
      this.#started = false;
      throw new Error("Unable to start Playwright screencast", { cause: error });
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await this.#page.screencast.stop().catch(() => undefined);
  }
}
