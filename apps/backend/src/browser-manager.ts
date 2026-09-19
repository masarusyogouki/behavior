import { VIEWPORT } from "@behavior/protocol";
import { chromium, type Browser, type BrowserContext } from "playwright";

export class BrowserManager {
  readonly #contexts = new Set<BrowserContext>();
  #browser: Browser | undefined;
  #closing = false;

  async start(): Promise<void> {
    if (this.#browser) return;
    this.#browser = await chromium.launch({
      headless: true,
      chromiumSandbox: process.platform === "linux" && process.env.CHROMIUM_SANDBOX !== "false",
    });
    this.#browser.once("disconnected", () => {
      this.#browser = undefined;
      this.#contexts.clear();
      const level = this.#closing ? console.info : console.error;
      level(JSON.stringify({ event: "browser_disconnected", expected: this.#closing }));
    });
  }

  async createContext(): Promise<BrowserContext> {
    if (!this.#browser) throw new Error("Chromium is not running");
    const context = await this.#browser.newContext({ viewport: VIEWPORT, acceptDownloads: false });
    this.#contexts.add(context);
    context.once("close", () => this.#contexts.delete(context));
    return context;
  }

  async close(): Promise<void> {
    this.#closing = true;
    const contexts = [...this.#contexts];
    this.#contexts.clear();
    await Promise.allSettled(contexts.map((context) => context.close()));
    await this.#browser?.close();
    this.#browser = undefined;
  }
}
