import { isIP } from 'node:net'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const CLIENT_IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fly-client-ip',
] as const
const MAX_IP_HEADER_LENGTH = 256
const MAX_IP_CANDIDATE_LENGTH = 64

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfter: 0 }
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) }
  }
  current.count += 1
  return { allowed: true, retryAfter: 0 }
}

export function clientAddress(request: Request): string {
  for (const header of CLIENT_IP_HEADERS) {
    const value = request.headers.get(header)
    if (!value || value.length > MAX_IP_HEADER_LENGTH || hasControlChars(value)) continue
    for (const rawCandidate of value.split(',')) {
      const candidate = rawCandidate.trim()
      if (!candidate || candidate.length > MAX_IP_CANDIDATE_LENGTH || hasControlChars(candidate)) continue
      if (isIP(candidate)) return candidate
    }
  }
  return 'local'
}

export function __resetRateLimits() { buckets.clear() }
