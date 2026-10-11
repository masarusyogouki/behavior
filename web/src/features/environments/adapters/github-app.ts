import { createPrivateKey, sign } from 'node:crypto'

const GITHUB_API_VERSION = '2026-03-10'

export type GitHubAppConfig = {
  appId: string
  installationId: string
  privateKey: string
}

export type InstallationToken = {
  token: string
  expiresAt: string
}

type Fetch = typeof fetch

function base64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function required(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is not configured`)
  return trimmed
}

function githubError(status: number, body: unknown): Error {
  const message = typeof body === 'object' && body !== null && 'message' in body
    && typeof body.message === 'string'
    ? body.message
    : 'GitHub API request failed'
  return new Error(`GitHub API error ${status}: ${message}`)
}

export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
  return {
    appId: required(env.GITHUB_APP_ID ?? '', 'GITHUB_APP_ID'),
    installationId: required(env.GITHUB_APP_INSTALLATION_ID ?? '', 'GITHUB_APP_INSTALLATION_ID'),
    privateKey: required(env.GITHUB_APP_PRIVATE_KEY ?? '', 'GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }
}

export function createGitHubAppJwt(
  config: Pick<GitHubAppConfig, 'appId' | 'privateKey'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64urlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.appId,
  })
  const signingInput = `${header}.${payload}`
  const key = createPrivateKey(config.privateKey)
  if (key.asymmetricKeyType !== 'rsa') throw new Error('GITHUB_APP_PRIVATE_KEY must be an RSA private key')
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url')
  return `${signingInput}.${signature}`
}

export class GitHubAppClient {
  private readonly config: GitHubAppConfig
  private readonly fetchImpl: Fetch
  private cachedToken: InstallationToken | null = null

  constructor(config: GitHubAppConfig, fetchImpl: Fetch = fetch) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  async installationToken(): Promise<InstallationToken> {
    if (this.cachedToken && Date.parse(this.cachedToken.expiresAt) > Date.now() + 60_000) {
      return this.cachedToken
    }

    const jwt = createGitHubAppJwt(this.config)
    const response = await this.fetchImpl(
      `https://api.github.com/app/installations/${encodeURIComponent(this.config.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': 'behavior-cloudflare-worker',
        },
      },
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) throw githubError(response.status, body)
    if (
      typeof body !== 'object'
      || body === null
      || !('token' in body)
      || typeof body.token !== 'string'
      || !('expires_at' in body)
      || typeof body.expires_at !== 'string'
    ) {
      throw new Error('GitHub API returned an invalid installation token response')
    }
    this.cachedToken = { token: body.token, expiresAt: body.expires_at }
    return this.cachedToken
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/')) throw new Error('GitHub API path must start with /')
    const { token } = await this.installationToken()
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/vnd.github+json')
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION)
    headers.set('User-Agent', 'behavior-cloudflare-worker')
    const response = await this.fetchImpl(`https://api.github.com${path}`, { ...init, headers })
    if (response.ok) return response
    const body: unknown = await response.json().catch(() => null)
    throw githubError(response.status, body)
  }
}
