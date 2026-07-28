import 'server-only'
import { compare } from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { SESSION_COOKIE, verifySessionToken, type Session } from '@/lib/session-token'
export { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session-token'
export type { Session } from '@/lib/session-token'

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return token ? verifySessionToken(token) : null
}

export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) throw new AuthError()
  return session
}

export class AuthError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'AuthError'
  }
}

export async function authenticate(email: string, password: string): Promise<Session | null> {
  const normalizedEmail = email.trim().toLowerCase()
  const configured = process.env.PILOT_EMAIL?.trim().toLowerCase()
  if (configured && normalizedEmail !== configured) return null
  const user = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (!user || !(await compare(password, user.passwordHash))) return null
  return { userId: user.id, workspaceId: user.workspaceId, email: user.email, displayName: user.displayName }
}
