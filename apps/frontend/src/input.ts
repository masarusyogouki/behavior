export type ViewportPoint = { x: number; y: number };

export function toViewportPoint(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
  viewport: { width: number; height: number },
): ViewportPoint | undefined {
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
  const renderedWidth = viewport.width * scale;
  const renderedHeight = viewport.height * scale;
  const offsetX = rect.left + (rect.width - renderedWidth) / 2;
  const offsetY = rect.top + (rect.height - renderedHeight) / 2;
  const relativeX = clientX - offsetX;
  const relativeY = clientY - offsetY;

  if (relativeX < 0 || relativeY < 0 || relativeX >= renderedWidth || relativeY >= renderedHeight) {
    return undefined;
  }

  return {
    x: Math.min(viewport.width - 1, Math.max(0, Math.floor(relativeX / scale))),
    y: Math.min(viewport.height - 1, Math.max(0, Math.floor(relativeY / scale))),
  };
}

export function keyboardModifiers(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) {
  const modifiers: Array<"Alt" | "Control" | "Meta" | "Shift"> = [];
  if (event.altKey) modifiers.push("Alt");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.metaKey) modifiers.push("Meta");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

export function shouldForwardKey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">): boolean {
  return (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.key.length > 1 ||
    event.key === " "
  );
}
