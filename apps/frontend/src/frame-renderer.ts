export class CanvasFrameRenderer {
  readonly #canvas: HTMLCanvasElement;
  #pendingFrame: ArrayBuffer | undefined;
  #rendering = false;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  push(frame: ArrayBuffer): void {
    if (this.#disposed) return;
    this.#pendingFrame = frame;
    if (!this.#rendering) void this.#renderLatest();
  }

  dispose(): void {
    this.#disposed = true;
    this.#pendingFrame = undefined;
  }

  async #renderLatest(): Promise<void> {
    this.#rendering = true;
    while (!this.#disposed && this.#pendingFrame) {
      const frame = this.#pendingFrame;
      this.#pendingFrame = undefined;
      const bitmap = await createImageBitmap(new Blob([frame], { type: "image/jpeg" }));
      try {
        if (this.#disposed) return;
        this.#canvas.getContext("2d")?.drawImage(bitmap, 0, 0, this.#canvas.width, this.#canvas.height);
      } finally {
        bitmap.close();
      }
    }
    this.#rendering = false;
  }
}
