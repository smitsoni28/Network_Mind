import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { ZodError, type ZodType } from 'zod'
import { AuthError, requireSession, type Session } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) { super(message) }
}

function prismaCode(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code
  if (error instanceof Prisma.PrismaClientInitializationError) return error.errorCode
  return undefined
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isMissingSchemaError(error: unknown) {
  const code = prismaCode(error)
  if (code === 'P2021' || code === 'P2022') return true
  return /(?:table|relation|column).+does not exist/iu.test(errorMessage(error))
}

function isDatabaseConnectionError(error: unknown) {
  const code = prismaCode(error)
  return code === 'P1000' || code === 'P1001' || code === 'P1002' || code === 'P1003'
}

export async function parseJson<T>(request: Request, schema: ZodType<T>, maxBytes = 250_000): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new ApiError(413, 'Request body is too large')
  let raw: unknown
  try { raw = await request.json() } catch { throw new ApiError(400, 'Invalid JSON request body') }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ApiError(400, 'Invalid request', result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`))
  }
  return result.data
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
  if (error instanceof ZodError) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (isMissingSchemaError(error)) {
    console.error('Database schema is not ready. Run npm run db:migrate before starting the app.', { code: prismaCode(error), message: errorMessage(error) })
    return NextResponse.json({ error: 'Database schema is not ready. Run migrations and try again.' }, { status: 503 })
  }
  if (isDatabaseConnectionError(error)) {
    console.error('Database is not reachable. Start Postgres and run npm run db:wait.', { code: prismaCode(error), message: errorMessage(error) })
    return NextResponse.json({ error: 'Database is not reachable. Start Postgres and try again.' }, { status: 503 })
  }
  console.error('Unhandled API error', errorMessage(error))
  return NextResponse.json({ error: 'The request could not be completed' }, { status: 500 })
}

export async function secureRequest(request: Request, action: string, limit = 20): Promise<Session> {
  const session = await requireSession()
  const rate = checkRateLimit(`${action}:${session.userId}`, limit, 60_000)
  if (!rate.allowed) throw new ApiError(429, 'Too many requests. Please try again shortly.')
  return session
}
