import { environmentHandlers } from '../../../server/environment-handlers.ts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return environmentHandlers().login(request)
}
