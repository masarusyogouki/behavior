import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserUrlAllowed, isPublicAddress } from '../security/network-policy.ts'

test('blocks private, loopback, link-local, documentation, and metadata IPv4 addresses', () => {
  for (const address of [
    '0.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
  ]) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('8.8.8.8'), true)
})

test('blocks local IPv6 addresses and permits a public IPv6 address', () => {
  for (const address of ['::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

test('blocks local hostnames and DNS answers containing a private address', async () => {
  assert.equal(await isBrowserUrlAllowed('http://localhost/'), false)
  assert.equal(await isBrowserUrlAllowed('https://service.internal/'), false)
  assert.equal(await isBrowserUrlAllowed('https://example.test/', async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.2', family: 4 },
  ]), false)
})

test('permits public HTTP destinations and safe non-network browser URLs', async () => {
  assert.equal(await isBrowserUrlAllowed('https://example.test/', async () => [
    { address: '93.184.216.34', family: 4 },
  ]), true)
  assert.equal(await isBrowserUrlAllowed('data:text/plain,ok'), true)
  assert.equal(await isBrowserUrlAllowed('about:blank'), true)
  assert.equal(await isBrowserUrlAllowed('file:///etc/passwd'), false)
})
