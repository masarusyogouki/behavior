declare module '@novnc/novnc' {
  export default class RFB {
    constructor(target: HTMLElement, url: string)
    scaleViewport: boolean
    focusOnClick: boolean
    disconnect(): void
    focus(options?: FocusOptions): void
    sendKey(keysym: number, code: string): void
    addEventListener(type: string, listener: EventListener): void
  }
}
