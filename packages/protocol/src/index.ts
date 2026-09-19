import { z } from "zod";

export const VIEWPORT = { width: 1280, height: 720 } as const;
export const MAX_TEXT_LENGTH = 4_096;
export const MAX_JSON_MESSAGE_BYTES = 16_384;
export const MAX_SCROLL_DELTA = 10_000;

const navigationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Only valid HTTP and HTTPS URLs are allowed");

const modifierSchema = z.enum(["Alt", "Control", "Meta", "Shift"]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: navigationUrlSchema }),
  z.object({ type: z.literal("goBack") }),
  z.object({ type: z.literal("goForward") }),
  z.object({ type: z.literal("reload") }),
  z.object({ type: z.literal("stopLoading") }),
  z.object({
    type: z.literal("click"),
    x: z.number().finite().min(0).max(VIEWPORT.width - 1),
    y: z.number().finite().min(0).max(VIEWPORT.height - 1),
    button: z.enum(["left", "middle", "right"]),
  }),
  z.object({ type: z.literal("insertText"), text: z.string().min(1).max(MAX_TEXT_LENGTH) }),
  z.object({
    type: z.literal("pressKey"),
    key: z.string().min(1).max(64),
    modifiers: z.array(modifierSchema).max(4),
  }),
  z.object({
    type: z.literal("scroll"),
    x: z.number().finite().min(0).max(VIEWPORT.width - 1),
    y: z.number().finite().min(0).max(VIEWPORT.height - 1),
    deltaX: z.number().finite().min(-MAX_SCROLL_DELTA).max(MAX_SCROLL_DELTA),
    deltaY: z.number().finite().min(-MAX_SCROLL_DELTA).max(MAX_SCROLL_DELTA),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sessionReady"),
    viewport: z.object({ width: z.literal(VIEWPORT.width), height: z.literal(VIEWPORT.height) }),
  }),
  z.object({
    type: z.literal("pageState"),
    url: z.string(),
    title: z.string(),
    loading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string(),
    recoverable: z.boolean(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export function parseServerMessage(value: unknown): ServerMessage {
  return serverMessageSchema.parse(value);
}
