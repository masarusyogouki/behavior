import { describe, expect, it } from "vitest";
import { MAX_SCROLL_DELTA, VIEWPORT, clientMessageSchema, serverMessageSchema } from "./index.js";

describe("clientMessageSchema", () => {
  it("accepts every supported command", () => {
    const messages = [
      { type: "navigate", url: "https://example.com/path" },
      { type: "goBack" },
      { type: "goForward" },
      { type: "reload" },
      { type: "stopLoading" },
      { type: "click", x: 10, y: 20, button: "left" },
      { type: "insertText", text: "こんにちは" },
      { type: "pressKey", key: "Enter", modifiers: ["Shift"] },
      { type: "scroll", x: 10, y: 20, deltaX: 0, deltaY: 200 },
    ];

    for (const message of messages) {
      expect(clientMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it.each(["file:///etc/passwd", "data:text/plain,hello", "javascript:alert(1)", "chrome://settings"])(
    "rejects the %s URL",
    (url) => {
      expect(clientMessageSchema.safeParse({ type: "navigate", url }).success).toBe(false);
    },
  );

  it("rejects unknown commands", () => {
    expect(clientMessageSchema.safeParse({ type: "drag" }).success).toBe(false);
  });

  it("rejects coordinates outside the viewport", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "click",
        x: VIEWPORT.width,
        y: VIEWPORT.height,
        button: "left",
      }).success,
    ).toBe(false);
  });

  it("rejects excessive scrolling", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "scroll",
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: MAX_SCROLL_DELTA + 1,
      }).success,
    ).toBe(false);
  });
});

describe("serverMessageSchema", () => {
  it("accepts a session-ready message", () => {
    expect(serverMessageSchema.safeParse({ type: "sessionReady", viewport: VIEWPORT }).success).toBe(true);
  });
});
