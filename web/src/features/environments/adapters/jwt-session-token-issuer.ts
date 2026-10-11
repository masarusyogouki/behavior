import type { SessionTokenIssuer } from '../application/ports.ts'
import { createSessionToken } from './session-token.ts'

export class JwtSessionTokenIssuer implements SessionTokenIssuer {
  private readonly privateKey: () => string

  constructor(privateKey: () => string) {
    this.privateKey = privateKey
  }

  issue(sessionId: string): string {
    return createSessionToken(sessionId, this.privateKey())
  }
}
