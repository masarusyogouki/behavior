import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteSession } from '../application/remote-session.ts'
import type { BrowserCommand, WorkerMessage } from '../../shared/contracts/browser.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture(options: {
  displayStart?: () => Promise<void>
  browserStart?: () => Promise<void>
  execute?: (command: BrowserCommand) => Promise<void>
  imeReady?: boolean
} = {}) {
  const calls: string[] = []
  const messages: WorkerMessage[] = []
  const session = new RemoteSession({
    display: {
      japaneseImeReady: options.imeReady ?? true,
      async start() { calls.push('display:start'); await options.displayStart?.() },
      close() { calls.push('display:close') },
    },
    browser: {
      async start() { calls.push('browser:start'); await options.browserStart?.() },
      async execute(command) { calls.push(`execute:${command.type}`); await options.execute?.(command) },
      async close() { calls.push('browser:close') },
    },
    sendMessage(message) { messages.push(message) },
  })
  return { session, calls, messages, displayReady() { calls.push('display:ready') } }
}

test('starts the display before the browser, starts once, and closes resources once', async () => {
  const f = fixture()
  await Promise.all([f.session.start(f.displayReady), f.session.start(f.displayReady)])
  assert.deepEqual(f.calls, ['display:start', 'display:ready', 'browser:start'])
  await Promise.all([f.session.close(), f.session.close()])
  assert.deepEqual(f.calls.slice(3), ['browser:close', 'display:close'])
  await f.session.execute({ type: 'reload' })
  await f.session.start(f.displayReady)
  assert.equal(f.calls.length, 5)
})

test('closing while the display starts never launches a browser and cleans late resources', async () => {
  const gate = deferred()
  const f = fixture({ displayStart: () => gate.promise })
  const started = f.session.start(f.displayReady)
  await f.session.close()
  gate.resolve()
  await started
  assert.equal(f.calls.includes('browser:start'), false)
  assert.equal(f.calls.includes('display:ready'), false)
  assert.equal(f.calls.at(-1), 'display:close')
})

test('closing while the browser starts signals browser cleanup without waiting for startup', async () => {
  const gate = deferred()
  const entered = deferred()
  const f = fixture({ browserStart: async () => { entered.resolve(); await gate.promise }, imeReady: false })
  const started = f.session.start(f.displayReady)
  await entered.promise
  await f.session.close()
  assert.ok(f.calls.includes('browser:close'))
  gate.resolve()
  await started
  assert.deepEqual(f.messages, [])
})

test('startup failures close both resources and propagate the failure', async () => {
  for (const resource of ['displayStart', 'browserStart'] as const) {
    const f = fixture({ [resource]: async () => { throw new Error('startup failed') } })
    await assert.rejects(f.session.start(f.displayReady), /startup failed/)
    assert.ok(f.calls.includes('browser:close'))
    assert.equal(f.calls.at(-1), 'display:close')
  }
})

test('serializes commands, reports failures, and continues with later commands', async () => {
  const gate = deferred()
  const entered = deferred()
  const f = fixture({ execute: async (command) => {
    if (command.type === 'back') { entered.resolve(); await gate.promise; throw new Error('navigation failed') }
  } })
  const first = f.session.execute({ type: 'back' })
  const second = f.session.execute({ type: 'reload' })
  await entered.promise
  assert.deepEqual(f.calls, ['execute:back'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(f.calls, ['execute:back', 'execute:reload'])
  assert.deepEqual(f.messages, [{ type: 'error', message: 'navigation failed' }])
})

test('close discards queued commands', async () => {
  const gate = deferred()
  const entered = deferred()
  const f = fixture({ execute: async () => { entered.resolve(); await gate.promise } })
  const first = f.session.execute({ type: 'back' })
  const second = f.session.execute({ type: 'reload' })
  await entered.promise
  await f.session.close()
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(f.calls.includes('execute:reload'), false)
})

test('IME failure is a non-fatal notification', async () => {
  const f = fixture({ imeReady: false })
  await f.session.start(f.displayReady)
  assert.ok(f.calls.includes('browser:start'))
  assert.equal(f.calls.includes('browser:close'), false)
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0].type, 'error')
  await f.session.close()
})
