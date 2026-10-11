import type { CreateEnvironmentResponse, EnvironmentStatus } from '../../../../../shared/contracts/environment.ts'
import { EnvironmentConflictError, requireSessionId } from '../domain/environment.ts'
import type { EnvironmentProvisioner, SessionTokenIssuer } from './ports.ts'

export class EnvironmentService {
  private readonly provisioner: EnvironmentProvisioner
  private readonly tokens: SessionTokenIssuer
  private readonly newSessionId: () => string

  constructor(dependencies: {
    provisioner: EnvironmentProvisioner
    tokens: SessionTokenIssuer
    newSessionId: () => string
  }) {
    this.provisioner = dependencies.provisioner
    this.tokens = dependencies.tokens
    this.newSessionId = dependencies.newSessionId
  }

  async create(): Promise<CreateEnvironmentResponse> {
    // Keep the current single-environment rule. Distributed admission control is future work.
    if (await this.provisioner.hasActiveEnvironment()) {
      throw new EnvironmentConflictError('A Worker session is already starting or running')
    }
    const sessionId = this.newSessionId()
    await this.provisioner.start(sessionId)
    return { sessionId }
  }

  async status(sessionId: string): Promise<EnvironmentStatus> {
    requireSessionId(sessionId)
    const environment = await this.provisioner.find(sessionId)
    if (!environment) return { sessionId, state: 'queued' }
    if (environment.state === 'ready') {
      return { sessionId, ...environment, token: this.tokens.issue(sessionId) }
    }
    return { sessionId, ...environment }
  }

  async stop(sessionId: string): Promise<void> {
    requireSessionId(sessionId)
    await this.provisioner.stop(sessionId)
  }
}
