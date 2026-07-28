import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contact, ContactEdge, Interaction } from '@prisma/client'

const mocks = vi.hoisted(() => {
  let recommendationIndex = 0
  const tx = {
    analysisRun: { create: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000001' })) },
    evidence: { createMany: vi.fn(async () => ({ count: 1 })) },
    recommendation: { create: vi.fn(async () => ({ id: `20000000-0000-4000-8000-${String(++recommendationIndex).padStart(12, '0')}` })) },
    auditLog: { create: vi.fn(async () => ({ id: 'audit' })) },
  }
  const db = {
    workspace: { findUniqueOrThrow: vi.fn() },
    contact: { findMany: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  }
  return { db, tx, resetIds: () => { recommendationIndex = 0 } }
})

vi.mock('@/lib/db', () => ({ db: mocks.db }))

import { runAnalysis } from '@/lib/services/analysis-service'
import type { WebSearchProvider } from '@/lib/tools/web-search'

type TestContact = Contact & { interactions: Interaction[]; outgoingEdges: ContactEdge[] }
const base = { workspaceId: 'w', primaryEmail: null, normalizedEmail: null, primaryPhone: null, normalizedPhone: null, relationshipStrength: 'WARM', lastContactAt: new Date('2026-01-01'), howMet: null, createdAt: new Date(), updatedAt: new Date(), importedAt: new Date(), source: 'TEST', archivedAt: null, interactions: [], outgoingEdges: [] } as const
function contact(index: number, overrides: Partial<TestContact> = {}): TestContact {
  const fullName = `Investor ${index}`
  return { ...base, id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`, fullName, normalizedName: fullName.toLowerCase(), company: `Fund ${index}`, normalizedCompany: `fund ${index}`, role: 'Venture Capital Investor', location: 'Berlin, Germany', tags: ['investment', 'fundraising'], notes: 'Supports startup fundraising', ...overrides } as TestContact
}

beforeEach(() => {
  mocks.resetIds()
  vi.clearAllMocks()
  mocks.db.workspace.findUniqueOrThrow.mockResolvedValue({ id: 'w', webEnrichmentEnabled: true })
})

describe('analysis response behavior', () => {
  const forbiddenUserFacing = [
    'networkmind-semantic-v2',
    'Required concept',
    'Preferred signals',
    '60 match threshold',
    'raw evidence',
    'Current web information was retrieved, but a grounded answer could not be generated.',
    'What would you like me to look for or explain?',
  ]

  it('reports totalMatches separately from the top five', async () => {
    mocks.db.contact.findMany.mockResolvedValue(Array.from({ length: 7 }, (_, index) => contact(index + 1)))
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Who in my network works in venture capital?', networkOnly: true })
    expect(response.totalMatches).toBe(7)
    expect(response.recommendations).toHaveLength(5)
    expect(response.answer).toBe('Found 7 relevant contacts. Showing the top 5.')
    expect(response.hasMore).toBe(true)
  })

  it('mixed mode searches only the topic and ignores generic web-snippet vocabulary', async () => {
    const investor = contact(1, { fullName: 'Nora Wagner', normalizedName: 'nora wagner' })
    const sameNameNoise = contact(2, { fullName: 'Alex Smith', normalizedName: 'alex smith', company: 'Growth Works', normalizedCompany: 'growth works', role: 'Consultant', tags: ['strategy'], notes: 'Experienced across expansion and growth' })
    mocks.db.contact.findMany.mockResolvedValue([investor, sameNameNoise])
    const provider: WebSearchProvider = { name: 'mock-web', search: vi.fn(async () => [{ title: 'German AI investment report', url: 'https://example.org/report', snippet: 'Experienced investors discuss expansion and growth across German AI startups.', source: 'example.org', retrievedAt: '2026-06-22T00:00:00.000Z' }]) }
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.', provider })
    expect(response.intent).toBe('MIXED_RESEARCH')
    expect(response.mode).toBe('MIXED')
    expect(mocks.tx.analysisRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ query: 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.' }) }))
    expect(provider.search).toHaveBeenCalledTimes(1)
    expect(provider.search).toHaveBeenCalledWith('AI startup investment activity in Germany', { limit: 6 })
    expect(response.answer).toContain('Public research')
    expect(response.answer).toContain('Relevant people in your network')
    expect(response.topicSources).toHaveLength(1)
    expect(response.contactVerificationSources).toEqual([])
    expect(response.recommendations.map((item) => item.contact.fullName)).toEqual(['Nora Wagner'])
    expect(response.evidence.filter((item) => item.type === 'WEB').every((item) => item.contactId === null)).toBe(true)
    expect(response.answer).not.toMatch(/works signals|relevant people signals|activity research/iu)
  })

  it('network-only mixed mode blocks web research but still searches extracted private concepts', async () => {
    const investor = contact(1, { fullName: 'Nora Wagner', normalizedName: 'nora wagner' })
    mocks.db.contact.findMany.mockResolvedValue([investor])
    const provider: WebSearchProvider = { name: 'mock-web', search: vi.fn(async () => [{ title: 'Should not run', url: 'https://example.org/report', snippet: 'unused', source: 'example.org', retrievedAt: '2026-06-22T00:00:00.000Z' }]) }
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.', provider, networkOnly: true })
    expect(provider.search).not.toHaveBeenCalled()
    expect(response.intent).toBe('MIXED_RESEARCH')
    expect(response.mode).toBe('NETWORK')
    expect(response.answer).toContain('Public research is disabled in Network-only mode.')
    expect(response.answer).toContain('Relevant people in your network')
    expect(response.recommendations.map((item) => item.contact.fullName)).toEqual(['Nora Wagner'])
    expect(response.diagnostics).toMatchObject({ status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH' })
  })

  it('pure public research with Network-only on blocks web and contact search', async () => {
    mocks.db.contact.findMany.mockResolvedValue([contact(1)])
    const provider: WebSearchProvider = { name: 'mock-web', search: vi.fn(async () => [{ title: 'Should not run', url: 'https://example.org/report', snippet: 'unused', source: 'example.org', retrievedAt: '2026-06-22T00:00:00.000Z' }]) }
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Research AI startup investment activity in Germany.', provider, networkOnly: true })
    expect(response.intent).toBe('BLOCKED_BY_MODE')
    expect(response.mode).toBe('DIRECT')
    expect(provider.search).not.toHaveBeenCalled()
    expect(mocks.db.contact.findMany).not.toHaveBeenCalled()
    expect(response.answer).toContain('Public research is disabled in Network-only mode')
    expect(response.answer).toContain('Research AI startup investment activity in Germany.')
    expect(response.diagnostics).toMatchObject({ status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH' })
  })

  it('does not handle a message-writing request as contact retrieval', async () => {
    const provider: WebSearchProvider = { name: 'mock-web', search: vi.fn(async () => []) }
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Write a short LinkedIn message asking about AI startup investment activity in Germany.', provider })
    expect(response.intent).toBe('MESSAGE_DRAFT')
    expect(response.answer).toBe('Choose a contact from the recommendations and select Draft message.')
    expect(response.recommendations).toEqual([])
    expect(mocks.db.contact.findMany).not.toHaveBeenCalled()
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('returns exact stored facts for one full-name lookup', async () => {
    mocks.db.contact.findMany.mockResolvedValue([
      contact(1, { fullName: 'Tomáš Dubois', normalizedName: 'tomáš dubois', role: 'Founder', company: 'Unicode Labs', normalizedCompany: 'unicode labs' }),
      contact(2, { fullName: 'Emma Dubois', normalizedName: 'emma dubois' }),
    ])
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Find Tomáš Dubois.', networkOnly: true })
    expect(response.recommendations.map((item) => item.contact.fullName)).toEqual(['Tomáš Dubois'])
    expect(response.recommendations[0].exactMatch).toBe(true)
    expect(response.evidence.map((item) => item.detail)).toContain('Role: Founder')
    expect(response.answer).toBe('Exact match found.')
  })

  it('resolves show/open full-name lookups but not plural categories', async () => {
    mocks.db.contact.findMany.mockResolvedValue([
      contact(1, { fullName: 'Rahul Joshi', normalizedName: 'rahul joshi', role: 'Product Manager', company: 'NeuralForge AI', normalizedCompany: 'neuralforge ai' }),
      contact(2, { fullName: 'Riley Revenue', normalizedName: 'riley revenue', role: 'Account Executive', tags: ['sales'] }),
    ])
    const exact = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'show me Rahul Joshi', networkOnly: true })
    expect(exact.intent).toBe('CONTACT_LOOKUP')
    expect(exact.recommendations.map((item) => item.contact.fullName)).toEqual(['Rahul Joshi'])

    const category = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'find me friends in sales', networkOnly: true })
    expect(category.intent).toBe('NETWORK_SEARCH')
    expect(category.recommendations.map((item) => item.contact.fullName)).toEqual(['Riley Revenue'])
  })

  it('does not fabricate verified introduction paths from topical relevance', async () => {
    mocks.db.contact.findMany.mockResolvedValue([
      contact(1, { fullName: 'Ada AI', normalizedName: 'ada ai', notes: 'Knows many AI founders and follows Elon Musk news', outgoingEdges: [] }),
    ])
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Who can introduce me to Elon Musk?', networkOnly: true })
    expect(response.intent).toBe('INTRODUCTION_PATH')
    expect(response.mode).toBe('VERIFIED_PATH')
    expect(response.answer).toBe('No verified introduction path found.')
    expect(response.recommendations).toEqual([])
    expect(response.uncertainty).toContain('No verified stored relationship evidence supports this introduction request.')
  })

  it('preserves honest no-result behavior', async () => {
    mocks.db.contact.findMany.mockResolvedValue([contact(1)])
    const response = await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Who in my network knows quantum cryptography?', networkOnly: true })
    expect(response.totalMatches).toBe(0)
    expect(response.recommendations).toEqual([])
    expect(response.answer).toContain('I searched 1 contact')
    expect(response.answer).toContain('None were a strong enough match')
    expect(response.diagnostics).toMatchObject({ status: 'NO_MATCHES', totalContactsChecked: 1 })
  })

  it('keeps representative user-facing outputs free of internal diagnostics', async () => {
    mocks.db.contact.findMany.mockResolvedValue([contact(1)])
    const provider: WebSearchProvider = { name: 'mock-web', search: vi.fn(async () => []) }
    const responses = [
      await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Research AI startup investment activity in Germany.', networkOnly: true, provider }),
      await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Who in my network knows quantum cryptography?', networkOnly: true, provider }),
      await runAnalysis({ workspaceId: 'w', userId: 'u', query: 'Who can introduce me to Elon Musk?', networkOnly: true, provider }),
    ]
    for (const response of responses) {
      for (const forbidden of forbiddenUserFacing) expect(response.answer).not.toContain(forbidden)
      expect(response.answer).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu)
    }
  })
})
