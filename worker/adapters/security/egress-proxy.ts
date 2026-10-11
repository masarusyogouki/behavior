import { Agent, createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { resolvePublicAddress, type Resolver } from './network-policy.ts'

export type Dial = (address: string, port: number) => Socket

function destination(raw: string, tunnel: boolean): URL {
  if (tunnel && !/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(?:80|443)$/.test(raw)) throw new Error('Blocked destination')
  const url = new URL(tunnel ? `http://${raw}` : raw)
  if (url.protocol !== 'http:' || url.username || url.password || url.hash || ![80, 443].includes(Number(url.port || 80))) throw new Error('Blocked destination')
  return url
}

function safeHeaders(headers: IncomingHttpHeaders, host?: string): IncomingHttpHeaders {
  const result = { ...headers }
  if (host) result.host = host
  for (const name of [...(headers.connection ?? '').split(',').map((v) => v.trim().toLowerCase()), 'connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'upgrade']) delete result[name]
  return result
}

// This container alone has internet access. All connections use the validated IP,
// including HTTPS and WebSocket CONNECT tunnels, preventing DNS rebinding.
export function createEgressProxy(options: { resolver?: Resolver; dial?: Dial } = {}) {
  const dial: Dial = options.dial ?? ((host, port) => connect({ host, port }))
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) => {
    if (request.url === '/health' && request.method === 'GET') { response.end('ok'); return }
    void (async () => {
      try {
        const url = destination(request.url ?? '', false)
        const target = await resolvePublicAddress(url.hostname, options.resolver)
        if (response.destroyed) return
        const agent = new Agent({ keepAlive: false })
        agent.createConnection = () => dial(target.address, Number(url.port || 80))
        const upstream = httpRequest({
          hostname: target.address, port: Number(url.port || 80), method: request.method,
          path: `${url.pathname}${url.search}`, headers: safeHeaders(request.headers, url.host),
          agent,
        }, (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, safeHeaders(incoming.headers))
          incoming.pipe(response)
          incoming.on('error', () => response.destroy())
        })
        upstream.setTimeout(30_000, () => upstream.destroy())
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() })
        response.on('close', () => { upstream.destroy(); agent.destroy() })
        request.on('error', () => upstream.destroy())
        request.pipe(upstream)
      } catch { response.writeHead(403).end('Blocked destination') }
    })()
  })

  server.on('connect', (request, client: Duplex, head) => {
    client.on('error', () => client.destroy())
    const timer = setTimeout(() => client.destroy(), 10_000)
    void (async () => {
      let upstream: Socket | undefined
      try {
        const url = destination(request.url ?? '', true)
        const target = await resolvePublicAddress(url.hostname, options.resolver)
        if (client.destroyed) return
        upstream = dial(target.address, Number(url.port || 80))
        upstream.setTimeout(60_000, () => upstream?.destroy())
        client.on('close', () => upstream?.destroy())
        upstream.on('error', () => client.destroy())
        upstream.on('close', () => client.destroy())
        upstream.once('connect', () => {
          clearTimeout(timer)
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head.length) upstream!.write(head)
          client.pipe(upstream!).pipe(client)
        })
      } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') }
      finally { if (!upstream) clearTimeout(timer) }
    })()
  })
  // ws:// upgrades are explicitly denied; wss:// uses the same validated CONNECT path.
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'))
  server.maxConnections = 256
  return server
}
