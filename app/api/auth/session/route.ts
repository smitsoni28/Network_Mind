import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
export async function GET() {
  const session = await getSession()
  return session ? NextResponse.json({ user: { email: session.email, displayName: session.displayName } }) : NextResponse.json({ error: 'Authentication required' }, { status: 401 })
}
