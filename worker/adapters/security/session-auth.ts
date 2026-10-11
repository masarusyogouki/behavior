import { createPublicKey, verify, type KeyObject } from 'node:crypto'

const CONTROL_PROTOCOL = 'behavior.v1'
const JWT_PROTOCOL_PREFIX = 'behavior.jwt.'

type SessionClaims = {
  sessionId: string
  audience: string
  exp: number
  jti: string
}

export type SessionAuthOptions = {
  sessionId: string
  audience: string
  publicKeyPem: string
  maxTokenTtlSeconds: number
}

function decodeJson(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JWT segment must contain an object')
  }
  return value as Record<string, unknown>
}

function sessionClaims(value: Record<string, unknown>): SessionClaims | null {
  if (
    typeof value.sessionId !== 'string'
    || typeof value.audience !== 'string'
    || typeof value.exp !== 'number'
    || !Number.isSafeInteger(value.exp)
    || typeof value.jti !== 'string'
    || value.jti.length < 1
    || value.jti.length > 128
  ) return null
  return {
    sessionId: value.sessionId,
    audience: value.audience,
    exp: value.exp,
    jti: value.jti,
  }
}

export function tokenFromProtocols(header: string | string[] | undefined): string | null {
  const protocols = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!protocols.includes(CONTROL_PROTOCOL)) return null
  const tokens = protocols.filter((value) => value.startsWith(JWT_PROTOCOL_PREFIX))
  if (tokens.length !== 1) return null
  const token = tokens[0].slice(JWT_PROTOCOL_PREFIX.length)
  return token.length > 0 && token.length <= 8192 ? token : null
}

export class SessionTokenVerifier {
  private readonly sessionId: string
  private readonly audience: string
  private readonly publicKey: KeyObject
  private readonly maxTokenTtlSeconds: number
  private readonly usedTokenIds = new Map<string, number>()

  constructor(options: SessionAuthOptions) {
    if (!options.sessionId) throw new Error('WORKER_SESSION_ID must not be empty')
    if (!options.audience) throw new Error('WORKER_SESSION_AUDIENCE must not be empty')
    this.sessionId = options.sessionId
    this.audience = options.audience
    this.publicKey = createPublicKey(options.publicKeyPem)
    if (this.publicKey.asymmetricKeyType !== 'rsa') {
      throw new Error('WORKER_SESSION_PUBLIC_KEY must be an RSA public key')
    }
    this.maxTokenTtlSeconds = options.maxTokenTtlSeconds
  }

  verifyAndConsume(token: string, nowSeconds = Math.floor(Date.now() / 1000)): SessionClaims | null {
    for (const [jti, expiry] of this.usedTokenIds) {
      if (expiry <= nowSeconds) this.usedTokenIds.delete(jti)
    }

    const segments = token.split('.')
    if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) return null
    try {
      const header = decodeJson(segments[0])
      if (header.alg !== 'RS256' || header.typ !== 'JWT') return null
      const claims = sessionClaims(decodeJson(segments[1]))
      if (!claims) return null
      if (claims.sessionId !== this.sessionId || claims.audience !== this.audience) return null
      if (claims.exp <= nowSeconds || claims.exp > nowSeconds + this.maxTokenTtlSeconds) return null
      if (this.usedTokenIds.has(claims.jti)) return null
      const valid = verify(
        'RSA-SHA256',
        Buffer.from(`${segments[0]}.${segments[1]}`),
        this.publicKey,
        Buffer.from(segments[2], 'base64url'),
      )
      if (!valid) return null
      this.usedTokenIds.set(claims.jti, claims.exp)
      return claims
    } catch {
      return null
    }
  }
}

export function controlProtocol(): string {
  return CONTROL_PROTOCOL
}
