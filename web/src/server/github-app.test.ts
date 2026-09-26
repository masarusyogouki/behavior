import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'

import { createGitHubAppJwt, GitHubAppClient } from './github-app.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()

test('creates a short-lived RS256 GitHub App JWT', () => {
  const token = createGitHubAppJwt({ appId: '5086041', privateKey: privateKeyPem }, 2_000_000_000)
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
    iat: 1_999_999_940,
    exp: 2_000_000_540,
    iss: '5086041',
  })
  assert.equal(
    verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    true,
  )
})

test('exchanges the app JWT for an installation token and reuses it', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: input.toString(), init })
    return Response.json({ token: 'installation-token', expires_at: '2999-01-01T00:00:00Z' })
  }) as typeof fetch
  const client = new GitHubAppClient({
    appId: '5086041',
    installationId: '165150577',
    privateKey: privateKeyPem,
  }, fetchMock)

  assert.equal((await client.installationToken()).token, 'installation-token')
  assert.equal((await client.installationToken()).token, 'installation-token')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.github.com/app/installations/165150577/access_tokens')
  const headers = new Headers(requests[0].init?.headers)
  assert.match(headers.get('Authorization') ?? '', /^Bearer [^.]+\.[^.]+\.[^.]+$/)
})

test('does not include credentials in GitHub API errors', async () => {
  const fetchMock = (async () => Response.json({ message: 'Bad credentials' }, { status: 401 })) as typeof fetch
  const client = new GitHubAppClient({
    appId: '5086041',
    installationId: '165150577',
    privateKey: privateKeyPem,
  }, fetchMock)

  await assert.rejects(client.installationToken(), (error: unknown) => {
    assert.match(String(error), /GitHub API error 401: Bad credentials/)
    assert.doesNotMatch(String(error), /BEGIN RSA PRIVATE KEY|installation-token/)
    return true
  })
})
