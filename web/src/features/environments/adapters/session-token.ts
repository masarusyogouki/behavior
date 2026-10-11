import { createPrivateKey, sign } from 'node:crypto'

const SESSION_AUDIENCE = 'browser-worker'

function base64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function sessionPrivateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env.WORKER_SESSION_PRIVATE_KEY ?? '').trim().replace(/\\n/g, '\n')
  if (!value) throw new Error('WORKER_SESSION_PRIVATE_KEY is not configured')
  return value
}

export function createSessionToken(
  sessionId: string,
  privateKeyPem: string,
  options: { nowSeconds?: number; jti?: string; ttlSeconds?: number } = {},
): string {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttlSeconds = options.ttlSeconds ?? 120
  if (!sessionId || sessionId.length > 128) throw new Error('Invalid session ID')
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 300) {
    throw new Error('Session token TTL must be between 30 and 300 seconds')
  }
  const jti = options.jti ?? crypto.randomUUID()
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64urlJson({
    sessionId,
    audience: SESSION_AUDIENCE,
    exp: nowSeconds + ttlSeconds,
    jti,
  })
  const signingInput = `${header}.${payload}`
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'rsa') throw new Error('WORKER_SESSION_PRIVATE_KEY must be an RSA private key')
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url')
  return `${signingInput}.${signature}`
}
