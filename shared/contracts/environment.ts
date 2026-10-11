export type EnvironmentState =
  | 'queued'
  | 'building'
  | 'tunnel_waiting'
  | 'ready'
  | 'stopped'
  | 'failed'

export type EnvironmentStatus = {
  sessionId: string
  state: EnvironmentState
  runUrl?: string
  websocketUrl?: string
  token?: string
  message?: string
}

export type CreateEnvironmentResponse = { sessionId: string }
