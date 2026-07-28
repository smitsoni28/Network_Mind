import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session-token'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/api/auth/login')) return NextResponse.next()
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value ?? '')
  if (session) {
    if (pathname === '/login') return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }
  if (pathname === '/login') return NextResponse.next()
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const login = new URL('/login', request.url)
  login.searchParams.set('next', pathname)
  return NextResponse.redirect(login)
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)'] }
