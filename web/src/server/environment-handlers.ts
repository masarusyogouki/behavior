import { apiSecurityFromEnv, type ApiSecurity } from './api-security.ts'
import { environmentServiceFromEnv } from './environment-service.ts'
import { isSameOriginMutation } from './request-security.ts'
import { EnvironmentConflictError, EnvironmentNotFoundError } from '../features/environments/domain/environment.ts'
import type { EnvironmentService } from '../features/environments/application/environment-service.ts'

const headers = { 'Cache-Control': 'no-store' }
function errorResponse(status: number, message: string) { return Response.json({ message }, { status, headers }) }

export function environmentHandlers(dependencies: {
  security: () => ApiSecurity
  service: () => Pick<EnvironmentService, 'create' | 'status' | 'stop'>
} = { security: apiSecurityFromEnv, service: environmentServiceFromEnv }) {
  return {
    async login(request: Request): Promise<Response> {
      if (!isSameOriginMutation(request)) return errorResponse(403, '許可されていないリクエストです。')
      if (Number(request.headers.get('Content-Length') ?? 0) > 1024) return errorResponse(413, 'リクエストが大きすぎます。')
      let security: ApiSecurity
      try { security = dependencies.security(); security.identity(request) } catch { return errorResponse(503, '認証設定を確認してください。') }
      const reader = request.body?.getReader()
      if (!reader) return errorResponse(400, 'アクセスキーを指定してください。')
      let size = 0
      const chunks: Uint8Array[] = []
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > 1024) { await reader.cancel(); return errorResponse(413, 'リクエストが大きすぎます。') }
          chunks.push(value)
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
        if (typeof body !== 'object' || body === null || !('accessKey' in body) || typeof body.accessKey !== 'string') return errorResponse(400, 'アクセスキーを指定してください。')
        const cookie = security.login(request, body.accessKey)
        return cookie ? new Response(null, { status: 204, headers: { ...headers, 'Set-Cookie': cookie } }) : errorResponse(401, 'アクセスキーが正しくありません。')
      } catch { return errorResponse(400, 'リクエストを確認してください。') }
    },
    async handle(request: Request, sessionId?: string): Promise<Response> {
      if (request.method !== 'GET' && !isSameOriginMutation(request)) return errorResponse(403, '許可されていないリクエストです。')
      let security: ApiSecurity
      let id: string | null
      try { security = dependencies.security(); id = security.identity(request) } catch { return errorResponse(503, '認証設定を確認してください。') }
      if (!id) return errorResponse(401, 'アクセスキーを入力してください。')
      if (sessionId !== undefined && !security.owns(request, id, sessionId)) return errorResponse(403, 'この環境へのアクセス権がありません。')
      try {
        const service = dependencies.service()
        if (request.method === 'POST' && sessionId === undefined) {
          const result = await service.create()
          return Response.json(result, { status: 202, headers: { ...headers, 'Set-Cookie': security.ownershipCookie(request, id, result.sessionId) } })
        }
        if (request.method === 'GET' && sessionId !== undefined) return Response.json(await service.status(sessionId), { headers })
        if (request.method === 'DELETE' && sessionId !== undefined) {
          await service.stop(sessionId)
          return new Response(null, { status: 204, headers })
        }
        return errorResponse(405, '許可されていない操作です。')
      } catch (error) {
        if (error instanceof EnvironmentConflictError) return errorResponse(409, error.message)
        if (error instanceof EnvironmentNotFoundError) return errorResponse(404, '環境が見つかりません。')
        console.error('Environment operation failed:', error instanceof Error ? error.message : 'Unknown error')
        return errorResponse(500, '環境の操作に失敗しました。')
      }
    },
  }
}
