import { generateKeyPairSync, sign } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const now = Math.floor(Date.now() / 1000)

function token(jti) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sessionId: 'test-session',
    audience: 'browser-worker',
    exp: now + 240,
    jti,
  })).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

process.stdout.write(JSON.stringify({
  publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  token: token('probe-primary'),
  secondToken: token('probe-secondary'),
}))
