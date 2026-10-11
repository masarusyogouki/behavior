export class EnvironmentConflictError extends Error {}
export class EnvironmentNotFoundError extends Error {}

export function requireSessionId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new EnvironmentNotFoundError()
  }
}
