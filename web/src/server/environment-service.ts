// Composition root: runtime configuration and concrete adapters are wired only here.
import { EnvironmentService } from '../features/environments/application/environment-service.ts'
import { GitHubActionsProvisioner } from '../features/environments/adapters/github-actions-provisioner.ts'
import { GitHubAppClient, githubAppConfigFromEnv } from '../features/environments/adapters/github-app.ts'
import { JwtSessionTokenIssuer } from '../features/environments/adapters/jwt-session-token-issuer.ts'
import { sessionPrivateKeyFromEnv } from '../features/environments/adapters/session-token.ts'

export function environmentServiceFromEnv(): EnvironmentService {
  return new EnvironmentService({
    provisioner: new GitHubActionsProvisioner(new GitHubAppClient(githubAppConfigFromEnv())),
    tokens: new JwtSessionTokenIssuer(sessionPrivateKeyFromEnv),
    newSessionId: () => crypto.randomUUID(),
  })
}
