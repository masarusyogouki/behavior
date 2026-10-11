// Composition root: runtime configuration and concrete adapters are wired only here.
import { EnvironmentService } from '../features/environments/application/environment-service.ts'
import { GitHubActionsProvisioner } from '../features/environments/adapters/github-actions-provisioner.ts'
import { GitHubAppClient, githubAppConfigFromEnv } from '../features/environments/adapters/github-app.ts'
import { JwtSessionTokenIssuer } from '../features/environments/adapters/jwt-session-token-issuer.ts'
import { sessionPrivateKeyFromEnv } from '../features/environments/adapters/session-token.ts'
import { LocalWorkerProvisioner } from '../features/environments/adapters/local-worker-provisioner.ts'
import { requireSessionId } from '../features/environments/domain/environment.ts'

export function environmentServiceFromEnv(): EnvironmentService {
  if (process.env.WORKER_CONNECTION_MODE === 'local') {
    if (process.env.NODE_ENV !== 'development') throw new Error('Local Worker mode requires development mode')
    const sessionId = process.env.WORKER_SESSION_ID ?? ''
    requireSessionId(sessionId)
    return new EnvironmentService({
      provisioner: new LocalWorkerProvisioner(sessionId, process.env.WORKER_LOCAL_WS_URL ?? 'ws://127.0.0.1:3000'),
      tokens: new JwtSessionTokenIssuer(sessionPrivateKeyFromEnv),
      newSessionId: () => sessionId,
    })
  }
  return new EnvironmentService({
    provisioner: new GitHubActionsProvisioner(new GitHubAppClient(githubAppConfigFromEnv())),
    tokens: new JwtSessionTokenIssuer(sessionPrivateKeyFromEnv),
    newSessionId: () => crypto.randomUUID(),
  })
}
