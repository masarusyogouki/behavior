import { describe, expect, it } from "vitest";
import { keyboardModifiers, shouldForwardKey, toViewportPoint } from "./input";

describe("toViewportPoint", () => {
  it("maps scaled canvas coordinates to the Chromium viewport", () => {
    expect(
      toViewportPoint({ left: 10, top: 20, width: 640, height: 360 }, 330, 200, {
        width: 1280,
        height: 720,
      }),
    ).toEqual({ x: 640, y: 360 });
  });

  it("ignores clicks in letterbox padding", () => {
    expect(
      toViewportPoint({ left: 0, top: 0, width: 1000, height: 1000 }, 500, 100, {
        width: 1280,
        height: 720,
      }),
    ).toBeUndefined();
  });
});

describe("keyboard helpers", () => {
  it("returns active modifiers in Playwright order", () => {
    expect(keyboardModifiers({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: true })).toEqual([
      "Alt",
      "Control",
      "Shift",
    ]);
  });

  it("leaves ordinary printable input to beforeinput", () => {
    expect(shouldForwardKey({ key: "a", altKey: false, ctrlKey: false, metaKey: false })).toBe(false);
    expect(shouldForwardKey({ key: "Enter", altKey: false, ctrlKey: false, metaKey: false })).toBe(true);
  });
});
