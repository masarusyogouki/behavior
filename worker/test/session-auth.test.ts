import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import { SessionTokenVerifier, tokenFromProtocols } from '../security/session-auth.ts'
import { parseCommand } from '../protocol.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const now = 2_000_000_000

function jwt(claims: Record<string, unknown>, key = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function verifier(): SessionTokenVerifier {
  return new SessionTokenVerifier({
    sessionId: 'session-123',
    audience: 'browser-worker',
    publicKeyPem,
    maxTokenTtlSeconds: 300,
  })
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionId: 'session-123', audience: 'browser-worker', exp: now + 60, jti: 'token-1', ...overrides }
}

test('accepts a valid token once and rejects jti reuse', () => {
  const token = jwt(claims())
  const subject = verifier()
  assert.equal(subject.verifyAndConsume(token, now)?.sessionId, 'session-123')
  assert.equal(subject.verifyAndConsume(token, now), null)
})

test('rejects expired, wrong-session, wrong-audience, and overly long tokens', () => {
  assert.equal(verifier().verifyAndConsume(jwt(claims({ exp: now })), now), null)
  assert.equal(verifier().verifyAndConsume(jwt(claims({ sessionId: 'another-session' })), now), null)
  assert.equal(verifier().verifyAndConsume(jwt(claims({ audience: 'another-service' })), now), null)
  assert.equal(verifier().verifyAndConsume(jwt(claims({ exp: now + 301 })), now), null)
})

test('rejects a token signed by another key', () => {
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  assert.equal(verifier().verifyAndConsume(jwt(claims(), otherKey), now), null)
})

test('extracts JWT only from the expected WebSocket subprotocol pair', () => {
  assert.equal(tokenFromProtocols('behavior.v1, behavior.jwt.abc.def.sig'), 'abc.def.sig')
  assert.equal(tokenFromProtocols('behavior.jwt.abc.def.sig'), null)
  assert.equal(tokenFromProtocols('behavior.v1'), null)
  assert.equal(tokenFromProtocols('behavior.v1, behavior.jwt.one, behavior.jwt.two'), null)
})

test('parses an explicit disconnect command', () => {
  assert.deepEqual(parseCommand('{"type":"disconnect"}', 1280, 720), { type: 'disconnect' })
})
