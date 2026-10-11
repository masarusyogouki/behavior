import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'

import { createSessionToken } from './session-token.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

test('creates a Worker-compatible short-lived session JWT', () => {
  const token = createSessionToken('session-123', privateKeyPem, {
    nowSeconds: 2_000_000_000,
    jti: 'token-1',
    ttlSeconds: 120,
  })
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
    sessionId: 'session-123',
    audience: 'browser-worker',
    exp: 2_000_000_120,
    jti: 'token-1',
  })
  assert.equal(
    verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    true,
  )
})

test('rejects session token lifetimes outside the Worker limit', () => {
  assert.throws(() => createSessionToken('session-123', privateKeyPem, { ttlSeconds: 301 }))
})
