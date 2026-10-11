import { environmentHandlers } from '../../../../server/environment-handlers.ts'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ sessionId: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  return environmentHandlers().handle(request, (await context.params).sessionId)
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return environmentHandlers().handle(request, (await context.params).sessionId)
}
