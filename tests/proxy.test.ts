import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
}))

vi.mock('@/lib/session-token', () => ({
  SESSION_COOKIE: 'networkmind_session',
  verifySessionToken: mocks.verifySessionToken,
}))

import { config, proxy } from '@/proxy'

function request(path: string, token?: string) {
  return new NextRequest(`https://networkmind.example${path}`, {
    headers: token ? { cookie: `networkmind_session=${token}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifySessionToken.mockResolvedValue(null)
})

describe('proxy authentication routing', () => {
  it('allows the login API route through without checking the page session redirect', async () => {
    const response = await proxy(request('/api/auth/login'))

    expect(mocks.verifySessionToken).not.toHaveBeenCalled()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('redirects authenticated users away from the login page', async () => {
    mocks.verifySessionToken.mockResolvedValue({ userId: 'u', workspaceId: 'w', email: 'pilot@example.com', displayName: 'Pilot' })

    const response = await proxy(request('/login', 'token'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://networkmind.example/')
  })

  it('allows unauthenticated users to view the login page', async () => {
    const response = await proxy(request('/login'))

    expect(mocks.verifySessionToken).toHaveBeenCalledWith('')
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('allows authenticated users to access protected routes', async () => {
    mocks.verifySessionToken.mockResolvedValue({ userId: 'u', workspaceId: 'w', email: 'pilot@example.com', displayName: 'Pilot' })

    const response = await proxy(request('/settings', 'token'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns JSON 401 for unauthenticated API requests', async () => {
    const response = await proxy(request('/api/contacts'))
    const data = await response.json() as { error: string }

    expect(response.status).toBe(401)
    expect(data.error).toBe('Authentication required')
  })

  it('redirects unauthenticated page requests to login with the original pathname', async () => {
    const response = await proxy(request('/settings?tab=privacy'))
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(307)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/settings')
  })

  it('preserves the public asset exclusions in the matcher', () => {
    expect(JSON.stringify(config.matcher)).toContain('_next/static')
    expect(JSON.stringify(config.matcher)).toContain('_next/image')
    expect(JSON.stringify(config.matcher)).toContain('png')
    expect(JSON.stringify(config.matcher)).toContain('webp')
  })
})
