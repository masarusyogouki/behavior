import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { createEgressProxy } from '../adapters/security/egress-proxy.ts'
import { resolvePublicAddress } from '../adapters/security/network-policy.ts'

test('public resolution rejects every private answer and IPv6 transition/mapped representations', async () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '0:0:0:0:0:ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001::1']) {
    await assert.rejects(resolvePublicAddress('example.test', async () => [{ address, family: address.includes(':') ? 6 : 4 }]), /Blocked/)
  }
  await assert.rejects(resolvePublicAddress('example.test', async () => [{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.1', family: 4 }]), /Blocked/)
})

test('proxy blocks HTTP, CONNECT and WebSocket upgrades to private networks without dialing', async (t) => {
  let dialed = false
  const proxy = createEgressProxy({ resolver: async () => [{ address: '10.0.0.1', family: 4 }], dial: () => { dialed = true; throw new Error('must not dial') } })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => { proxy.closeAllConnections(); proxy.close() })
  const address = proxy.address()
  assert.ok(address && typeof address !== 'string')
  const proxyPort = address.port
  async function exchange(raw: string) {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(proxyPort, '127.0.0.1')
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('timeout')) })
      socket.on('error', reject)
      socket.on('connect', () => socket.write(raw))
      socket.once('data', (data) => { socket.destroy(); resolve(data.toString()) })
    })
  }
  for (const raw of [
    'GET http://169.254.169.254/latest/meta-data HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n',
    'CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n',
    'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n',
    'CONNECT example.test:5900 HTTP/1.1\r\nHost: example.test\r\n\r\n',
    'GET http://example.test/ HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
  ]) assert.match(await exchange(raw), /^HTTP\/1\.1 403/)
  assert.equal(dialed, false)
})

test('HTTP and CONNECT dial only the checked IP, with no second hostname lookup', async (t) => {
  const upstream = createServer((request, response) => { assert.equal(request.headers.host, 'example.test'); response.end('public content') })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamAddress = upstream.address()
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string')
  const calls: Array<[string, number]> = []
  let resolutions = 0
  const proxy = createEgressProxy({
    resolver: async () => { resolutions++; return [{ address: resolutions <= 2 ? '8.8.8.8' : '127.0.0.1', family: 4 }] },
    dial: (ip, port) => { calls.push([ip, port]); return connect(upstreamAddress.port, '127.0.0.1') },
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close() })
  const proxyAddress = proxy.address()
  assert.ok(proxyAddress && typeof proxyAddress !== 'string')
  const content = await new Promise<string>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: proxyAddress.port, path: 'http://example.test/', headers: { Host: 'attacker.test' } }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk }); response.on('end', () => resolve(body))
    }); req.on('error', reject); req.end()
  })
  assert.equal(content, 'public content')
  await new Promise<void>((resolve, reject) => {
    const socket = connect(proxyAddress.port, '127.0.0.1')
    socket.on('error', reject)
    socket.on('connect', () => socket.write('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n'))
    socket.once('data', (data) => { assert.match(data.toString(), /200 Connection Established/); socket.destroy(); resolve() })
  })
  assert.deepEqual(calls, [['8.8.8.8', 80], ['8.8.8.8', 443]])
  assert.equal(resolutions, 2)
  await assert.rejects(resolvePublicAddress('example.test', async () => [{ address: '127.0.0.1', family: 4 }]), /Blocked/)
})
