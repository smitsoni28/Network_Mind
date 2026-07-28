import { describe, expect, it } from 'vitest'
import { askSchema, confirmImportSchema, generateMessageSchema } from '@/lib/schemas'
import { checkRateLimit, clientAddress, __resetRateLimits } from '@/lib/rate-limit'
import { identityStatus } from '@/lib/tools/enrichment'
import { extractTarget } from '@/lib/tools/entity-extraction'
import { verifyIntroductionPath } from '@/lib/tools/relationship-verification'
import { edgeMatches } from '@/lib/services/analysis-service'
import { validateRecommendationReferences } from '@/lib/ai/validate-recommendations'

const contact = { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com', company: 'Analytical Engines', role: 'Engineer', known: ['Works in the same industry as Elon Musk'], insights: [], relationship: { strength: 'Warm' as const, lastContact: 'today', howYouMet: 'Conference', mutualConnections: 0 } }
describe('validation and path safety', () => {
  it('rejects a missing query', () => expect(askSchema.safeParse({}).success).toBe(false))
  it('rejects an excessive query', () => expect(askSchema.safeParse({ question: 'x'.repeat(1001) }).success).toBe(false))
  it('rejects invalid IDs', () => expect(generateMessageSchema.safeParse({ contactId: 'x', analysisRunId: 'x', channel: 'EMAIL', tone: 'WARM' }).success).toBe(false))
  it('rejects malformed import rows', () => expect(confirmImportSchema.safeParse({ filename: 'x.csv', mapping: {}, includeWarnings: true, rows: [{ nope: true }] }).success).toBe(false))
  it('rate limits repeated requests', () => { __resetRateLimits(); expect(checkRateLimit('x', 1, 1000).allowed).toBe(true); expect(checkRateLimit('x', 1, 1000).allowed).toBe(false) })
  it('uses the first valid trusted client IP candidate', () => {
    const request = new Request('https://networkmind.example/login', { headers: { 'x-forwarded-for': 'unknown, 203.0.113.10, 198.51.100.2' } })
    expect(clientAddress(request)).toBe('203.0.113.10')
  })
  it('accepts IPv6 client addresses', () => {
    const request = new Request('https://networkmind.example/login', { headers: { 'x-real-ip': '2001:db8::1' } })
    expect(clientAddress(request)).toBe('2001:db8::1')
  })
  it('rejects unsafe or excessive client address headers and falls back safely', () => {
    const request = { headers: { get: (name: string) => name === 'x-forwarded-for' ? `203.0.113.10\u0001` : name === 'x-real-ip' ? 'x'.repeat(300) : null } } as unknown as Request
    expect(clientAddress(request)).toBe('local')
  })
  it('rejects topical similarity as a path', () => expect(verifyIntroductionPath(contact, extractTarget('Who can introduce me to Elon Musk?')).verified).toBe(false))
  it('accepts explicit relationship evidence', () => expect(verifyIntroductionPath({ ...contact, known: ['Worked with Elon Musk at Tesla'] }, extractTarget('Who can introduce me to Elon Musk?')).verified).toBe(true))
  it('does not confirm identity from company only', () => expect(identityStatus(contact, [{ title: 'Analytical Engines', url: 'https://example.com', source: 'example.com', snippet: 'Analytical Engines builds software' }])).toBe('UNVERIFIED'))
  it('rejects a same-industry web mention as a path', () => expect(verifyIntroductionPath(contact, extractTarget('Who can introduce me to Elon Musk?'), [{ title: 'Industry', url: 'https://example.com', source: 'example.com', snippet: 'Ada Lovelace is in the same industry as Elon Musk' }]).verified).toBe(false))
  it('accepts a verified stored ContactEdge', () => expect(edgeMatches({ id: 'e', workspaceId: 'w', fromContactId: 'c', toContactId: null, externalTargetName: 'Narendra Modi', externalTargetType: 'PERSON', relationshipType: 'KNOWS', evidence: 'Met directly', source: 'USER', verifiedAt: new Date(), createdAt: new Date() }, 'Narendra Modi')).toBe(true))
  it('rejects duplicate, excessive, and unknown model references', () => {
    const item = { contactId: 'c1', evidenceIds: ['ev-unknown'], reasoning: 'Reason', suggestedAction: 'Act', uncertainty: ['Unknown'], matchScore: 1, relationshipScore: 1, evidenceConfidence: 1, actionabilityScore: 1, priorityScore: 1 }
    expect(validateRecommendationReferences({ recommendations: [item, item] }, new Set(['c1']), new Set(['ev1'])).ok).toBe(false)
    expect(validateRecommendationReferences({ recommendations: Array.from({ length: 6 }, (_, i) => ({ ...item, contactId: `c${i}`, evidenceIds: ['ev1'] })) }, new Set(), new Set(['ev1'])).ok).toBe(false)
  })
})
