import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCommand, parseWorkerMessage } from './browser.ts'

test('retains browser command validation at the shared boundary', () => {
  assert.deepEqual(parseCommand('{"type":"down","x":10,"y":20,"button":"left"}', 1280, 720), {
    type: 'down', x: 10, y: 20, button: 'left',
  })
  for (const command of [
    { type: 'move', x: -1, y: 0 },
    { type: 'move', x: 1280, y: 0 },
    { type: 'down', x: 0, y: 0, button: 'unknown' },
    { type: 'text', text: 'x'.repeat(1001) },
  ]) assert.equal(parseCommand(JSON.stringify(command), 1280, 720), null)
  assert.throws(() => parseCommand('{', 1280, 720), SyntaxError)
})

test('validates messages before the UI consumes them', () => {
  const element = {
    tagName: 'input', outerHTML: '<input>', outerHTMLTruncated: false, text: '',
    attributes: [{ name: 'id', value: 'email' }],
    selectors: [{ type: 'id', value: 'email', playwright: 'page.locator("#email")', unique: true }],
    frame: { url: 'https://example.com', name: null, isMainFrame: true },
  }
  for (const message of [
    { type: 'ready', url: 'https://example.com', vncPath: '/vnc/token' },
    { type: 'url', url: 'https://example.com' },
    { type: 'error', message: 'failed' },
    { type: 'element-selected', element },
  ]) assert.deepEqual(parseWorkerMessage(JSON.stringify(message)), message)
  for (const message of [
    null, [], { type: 'unknown' }, { type: 'ready', vncPath: '/vnc/token' },
    { type: 'element-selected', element: { ...element, attributes: [null] } },
    { type: 'element-selected', element: { ...element, frame: {} } },
    { type: 'element-selected', element: { ...element, selectors: [{ type: 'invalid' }] } },
  ]) assert.equal(parseWorkerMessage(JSON.stringify(message)), null)
  assert.equal(parseWorkerMessage('{'), null)
})
