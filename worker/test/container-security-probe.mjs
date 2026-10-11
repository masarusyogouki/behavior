// Run inside the isolated Worker container with WORKER_PROXY_URL configured.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createRemoteSession } from '../composition.ts'

await assert.rejects(fetch('https://example.com', { signal: AbortSignal.timeout(3000) }))
console.log('Direct internet access blocked')

const browser = await chromium.launch({
  headless: true, channel: 'chromium', chromiumSandbox: true,
  proxy: { server: process.env.WORKER_PROXY_URL },
  args: ['--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
})
try {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
  const page = await context.newPage()
  await page.goto('https://example.com', { timeout: 30000 })
  assert.match(await page.title(), /Example Domain/)
  console.log('Public HTTPS via proxy and sandbox OK')
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:3128/health', 'http://10.0.0.1/']) {
    const response = await page.goto(url, { timeout: 5000 }).catch(() => null)
    assert.ok(response === null || response.status() === 403, `unexpected access: ${url}`)
  }
  console.log('Browser metadata, loopback and private destinations blocked')
  await page.goto('https://example.com')
  assert.equal(await page.evaluate(() => new Promise((resolve) => {
    const socket = new WebSocket('wss://127.0.0.1:443/')
    socket.onopen = () => { socket.close(); resolve('open') }
    socket.onerror = () => resolve('blocked')
    setTimeout(() => { socket.close(); resolve('timeout') }, 3000)
  })), 'blocked')
  console.log('Private WebSocket blocked')
  const sandboxPage = await context.newPage()
  await sandboxPage.goto('chrome://sandbox')
  assert.match(await sandboxPage.textContent('body'), /Seccomp-BPF sandbox\s*Yes/)
  console.log('Chromium reports Seccomp-BPF sandbox enabled')
} finally { await browser.close() }

// Also exercise the application's actual headed Chromium, VNC and IME startup.
const messages = []
const { session } = createRemoteSession((message) => messages.push(message), '/vnc/test')
try {
  await session.start(() => {})
  assert.ok(messages.some((message) => message.type === 'ready'))
  console.log('Application headed browser and VNC startup OK')
} finally { await session.close() }
