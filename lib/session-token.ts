import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'networkmind_session'
const SESSION_SECONDS = 60 * 60 * 12
export type Session = { userId: string; workspaceId: string; email: string; displayName: string }

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET?.trim()

  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production')
    }

    return new TextEncoder().encode(
      'networkmind-development-only-secret-change-me'
    )
  }

  if (process.env.NODE_ENV === 'production' && value.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production')
  }

  return new TextEncoder().encode(value)
}

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT(session).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).setIssuer('networkmind').setAudience('networkmind-pilot').sign(secret())
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'networkmind', audience: 'networkmind-pilot' })
    if (typeof payload.userId !== 'string' || typeof payload.workspaceId !== 'string' || typeof payload.email !== 'string' || typeof payload.displayName !== 'string') return null
    return payload as unknown as Session
  } catch { return null }
}

export const sessionCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: SESSION_SECONDS }
