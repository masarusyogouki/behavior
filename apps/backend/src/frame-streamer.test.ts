import { describe, expect, it } from "vitest";
import {
  FRAME_INTERVAL_MS,
  MAX_BUFFERED_FRAME_BYTES,
  shouldSendFrame,
} from "./frame-streamer.js";

describe("shouldSendFrame", () => {
  it("allows a frame after the frame interval", () => {
    expect(shouldSendFrame(1_050, 1_000, 0)).toBe(true);
  });

  it("drops frames that would exceed 20 fps", () => {
    expect(shouldSendFrame(1_000 + FRAME_INTERVAL_MS - 1, 1_000, 0)).toBe(false);
  });

  it("drops frames while the WebSocket is backed up", () => {
    expect(shouldSendFrame(1_100, 1_000, MAX_BUFFERED_FRAME_BYTES + 1)).toBe(false);
  });
});
