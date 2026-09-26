import {
  EnvironmentNotFoundError,
  environmentServiceFromEnv,
} from '../../../../server/environment-service'
import { isSameOriginMutation } from '../../../../server/request-security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ sessionId: string }> }

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { sessionId } = await context.params
  try {
    return Response.json(await environmentServiceFromEnv().status(sessionId), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof EnvironmentNotFoundError) {
      return Response.json({ message: '環境が見つかりません。' }, { status: 404 })
    }
    console.error('Failed to read environment:', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ message: '環境の状態を取得できませんでした。' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return Response.json({ message: '許可されていないリクエストです。' }, { status: 403 })
  }
  const { sessionId } = await context.params
  try {
    await environmentServiceFromEnv().stop(sessionId)
    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof EnvironmentNotFoundError) return new Response(null, { status: 204 })
    console.error('Failed to stop environment:', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ message: '環境を停止できませんでした。' }, { status: 500 })
  }
}
