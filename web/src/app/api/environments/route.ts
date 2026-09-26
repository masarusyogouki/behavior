import { EnvironmentConflictError, environmentServiceFromEnv } from '../../../server/environment-service'
import { isSameOriginMutation } from '../../../server/request-security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return Response.json({ message: '許可されていないリクエストです。' }, { status: 403 })
  }
  try {
    const result = await environmentServiceFromEnv().create()
    return Response.json(result, { status: 202 })
  } catch (error) {
    if (error instanceof EnvironmentConflictError) {
      return Response.json({ message: error.message }, { status: 409 })
    }
    console.error('Failed to create environment:', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ message: '環境を起動できませんでした。' }, { status: 500 })
  }
}
