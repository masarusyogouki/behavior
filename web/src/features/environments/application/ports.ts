import type { EnvironmentState } from '../../../../../shared/contracts/environment.ts'

export type ProvisionedEnvironment =
  | { state: 'ready'; websocketUrl: string; runUrl?: string }
  | { state: Exclude<EnvironmentState, 'ready'>; runUrl?: string; message?: string }

// The application sees environment operations, never workflow runs or HTTP responses.
export interface EnvironmentProvisioner {
  hasActiveEnvironment(): Promise<boolean>
  start(sessionId: string): Promise<void>
  find(sessionId: string): Promise<ProvisionedEnvironment | null>
  stop(sessionId: string): Promise<void>
}

export interface SessionTokenIssuer {
  issue(sessionId: string): string
}
