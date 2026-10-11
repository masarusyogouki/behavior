import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const TTL = 7 * 60 * 60
type Identity = { id: string; exp: number }
type Ownership = Identity & { sessionId: string }

export class ApiSecurity {
  private readonly accessKeyHash: Buffer
  private readonly signingKey: Buffer

  constructor(accessKey: string, signingSecret: string) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(accessKey) || signingSecret.length < 32) throw new Error('API authentication is not configured')
    this.accessKeyHash = createHash('sha256').update(accessKey).digest()
    this.signingKey = createHash('sha256').update('behavior-api-cookies-v1\0').update(signingSecret).digest()
  }

  private names(request: Request) {
    const url = new URL(request.url)
    const secure = url.protocol === 'https:'
    if (!secure && !(process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('API authentication requires HTTPS')
    return { auth: `${secure ? '__Host-' : ''}behavior-auth`, owner: `${secure ? '__Host-' : ''}behavior-owner`, secure }
  }

  private signature(kind: string, payload: string): string {
    return createHmac('sha256', this.signingKey).update(`${kind}.${payload}`).digest('base64url')
  }

  private encode(kind: string, value: Identity | Ownership): string {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${payload}.${this.signature(kind, payload)}`
  }

  private decode(request: Request, name: string, kind: string): Record<string, unknown> | null {
    const values = (request.headers.get('Cookie') ?? '').split(';').map((v) => v.trim()).filter((v) => v.startsWith(`${name}=`))
    if (values.length !== 1) return null
    const value = values[0].slice(name.length + 1)
    if (value.length > 2048) return null
    const parts = value.split('.')
    if (parts.length !== 2 || !parts.every((v) => /^[A-Za-z0-9_-]+$/.test(v))) return null
    const expected = Buffer.from(this.signature(kind, parts[0]))
    const actual = Buffer.from(parts[1])
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    try {
      const result: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
      if (typeof result !== 'object' || result === null || !('id' in result) || typeof result.id !== 'string'
        || !('exp' in result) || typeof result.exp !== 'number' || !Number.isSafeInteger(result.exp)
        || result.exp <= Math.floor(Date.now() / 1000)) return null
      return result as Record<string, unknown>
    } catch { return null }
  }

  private cookie(request: Request, name: string, value: string): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${this.names(request).secure ? '; Secure' : ''}`
  }

  login(request: Request, accessKey: string): string | null {
    this.names(request)
    const hash = createHash('sha256').update(accessKey).digest()
    if (!timingSafeEqual(this.accessKeyHash, hash)) return null
    const id = this.identity(request) ?? randomUUID()
    return this.cookie(request, this.names(request).auth, this.encode('auth', { id, exp: Math.floor(Date.now() / 1000) + TTL }))
  }

  identity(request: Request): string | null {
    const value = this.decode(request, this.names(request).auth, 'auth')
    return value ? value.id as string : null
  }

  ownershipCookie(request: Request, id: string, sessionId: string): string {
    return this.cookie(request, this.names(request).owner, this.encode('owner', { id, sessionId, exp: Math.floor(Date.now() / 1000) + TTL }))
  }

  owns(request: Request, id: string, sessionId: string): boolean {
    const value = this.decode(request, this.names(request).owner, 'owner')
    return value?.id === id && value?.sessionId === sessionId
  }
}

export function apiSecurityFromEnv(): ApiSecurity {
  return new ApiSecurity(process.env.BEHAVIOR_ACCESS_KEY ?? '', process.env.WORKER_SESSION_PRIVATE_KEY ?? '')
}
