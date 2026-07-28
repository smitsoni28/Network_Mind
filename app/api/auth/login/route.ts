import { NextResponse } from 'next/server'
import { authenticate, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { errorResponse, parseJson, ApiError } from '@/lib/api'
import { loginSchema } from '@/lib/schemas'
import { checkRateLimit, clientAddress } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const rate = checkRateLimit(`login:${clientAddress(request)}`, 5, 15 * 60_000)
    if (!rate.allowed) throw new ApiError(429, 'Too many login attempts. Try again later.')
    const body = await parseJson(request, loginSchema, 10_000)
    const session = await authenticate(body.email, body.password)
    if (!session) throw new ApiError(401, 'Invalid email or password')
    const response = NextResponse.json({ user: { email: session.email, displayName: session.displayName } })
    response.cookies.set(SESSION_COOKIE, await createSessionToken(session), sessionCookieOptions)
    return response
  } catch (error) { return errorResponse(error) }
}
