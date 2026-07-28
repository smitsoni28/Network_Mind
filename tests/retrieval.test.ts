import { describe, expect, it } from 'vitest'
import type { Contact } from '@prisma/client'
import { deterministicContactRetriever, retrievalDiagnostics } from '@/lib/services/retrieval'
import { routeQuery } from '@/lib/services/query-intent'

const base = { workspaceId: 'w', primaryEmail: null, normalizedEmail: null, primaryPhone: null, normalizedPhone: null, notes: null, relationshipStrength: 'WARM', lastContactAt: null, howMet: null, createdAt: new Date(), updatedAt: new Date(), importedAt: new Date(), source: 'TEST', archivedAt: null } as const
const contacts = [
  { ...base, id: '1', fullName: 'José Gründer', normalizedName: 'josé gründer', company: 'Alpen VC', normalizedCompany: 'alpen vc', role: 'Venture Capital Investor', location: 'Vienna, Austria', tags: ['founder'], notes: 'Advises industrial startups' },
  { ...base, id: '2', fullName: 'Tomáš Nair', normalizedName: 'tomáš nair', company: 'Factory AG', normalizedCompany: 'factory ag', role: 'Manufacturing Director', location: 'Berlin, Germany', tags: ['industrial'], notes: null },
  { ...base, id: '3', fullName: 'Unrelated Person', normalizedName: 'unrelated person', company: 'Bakery', normalizedCompany: 'bakery', role: 'Pastry chef', location: 'Paris', tags: [], notes: null },
] as unknown as Contact[]
describe('deterministic retrieval', () => {
  it('returns no fallback contacts', () => expect(deterministicContactRetriever.search(routeQuery('Who in my network knows quantum cryptography?'), contacts)).toHaveLength(0))
  it('weights role/company matches', () => expect(deterministicContactRetriever.search(routeQuery('Who in my network works in manufacturing?'), contacts)[0].contact.id).toBe('2'))
  it('suppresses generic words', () => expect(deterministicContactRetriever.search(routeQuery('show contacts in my network'), contacts)).toHaveLength(0))
  it('supports Unicode', () => expect(deterministicContactRetriever.search(routeQuery('Who in my network is José Gründer?'), contacts)[0].contact.id).toBe('1'))
  it('supports VC synonyms', () => expect(deterministicContactRetriever.search(routeQuery('Find VC in my network'), contacts)[0].contact.id).toBe('1'))
  it('supports manufacturing synonyms', () => expect(deterministicContactRetriever.search(routeQuery('Find industrial contacts in my network'), contacts)[0].contact.id).toBe('2'))
  it('supports DACH locations', () => expect(deterministicContactRetriever.search(routeQuery('Find DACH investors in my network'), contacts).map((r) => r.contact.id)).toContain('1'))
  it('uses real timestamps for reconnect', () => { const dated = contacts.map((c, i) => ({ ...c, lastContactAt: new Date(Date.now() - (i ? 20 : 200) * 86_400_000) })); expect(deterministicContactRetriever.search(routeQuery('Who have I not contacted recently?'), dated)[0].contact.id).toBe('1') })
  it('returns only an exact Unicode full-name match, not a shared surname', () => {
    const dubois = ['Tomáš Dubois', 'Emma Dubois', 'Eva Dubois', 'Nora Dubois', 'Theo Dubois'].map((fullName, index) => ({ ...contacts[0], id: `d${index}`, fullName, normalizedName: fullName.normalize('NFKC').toLocaleLowerCase('und') }))
    const results = deterministicContactRetriever.search(routeQuery('Find Tomáš Dubois.'), dubois)
    expect(results.map((result) => result.contact.fullName)).toEqual(['Tomáš Dubois'])
    expect(results[0].exactMatch).toBe(true)
  })
  it('does not qualify a location-only consultant for fundraising', () => {
    const fundraising = [
      { ...contacts[0], id: 'investor', fullName: 'Nora Wagner', normalizedName: 'nora wagner', role: 'Venture Capital Investor', location: 'Berlin, Germany', tags: ['investment'], notes: 'Helps startups raise funding' },
      { ...contacts[0], id: 'consultant', fullName: 'Generic Consultant', normalizedName: 'generic consultant', company: 'Consulting Co', normalizedCompany: 'consulting co', role: 'Consultant', location: 'DACH', tags: ['strategy'], notes: 'General business advice' },
    ]
    const results = deterministicContactRetriever.search(routeQuery('Which contacts in Germany could help with startup fundraising?'), fundraising)
    expect(results.map((result) => result.contact.id)).toEqual(['investor'])
  })
  it('enforces a two-year reconnect threshold', () => {
    const now = new Date('2026-06-22T00:00:00.000Z')
    const dated = [550, 730, 900].map((days, index) => ({ ...contacts[0], id: String(index), lastContactAt: new Date(now.getTime() - days * 86_400_000) }))
    const results = deterministicContactRetriever.search(routeQuery('Who have I not contacted in more than two years?'), dated, { now })
    expect(results.map((result) => result.inactiveDays)).toEqual([900, 730])
  })
  it('uses 90 days only for a reconnect query without an explicit duration', () => {
    const now = new Date('2026-06-22T00:00:00.000Z')
    const dated = [89, 90, 469].map((days, index) => ({ ...contacts[0], id: String(index), lastContactAt: new Date(now.getTime() - days * 86_400_000) }))
    const results = deterministicContactRetriever.search(routeQuery('Who have I not contacted recently?'), dated, { now })
    expect(results.map((result) => result.inactiveDays)).toEqual([469, 90])
  })
  it('routes informal sales friends to semantic sales contacts, not exact lookup', () => {
    const salesContacts = [
      { ...contacts[0], id: 'sales', fullName: 'Riley Revenue', normalizedName: 'riley revenue', role: 'Account Executive', company: 'Revenue Co', normalizedCompany: 'revenue co', tags: ['sales', 'gtm'], notes: 'Owns enterprise customer acquisition' },
      { ...contacts[0], id: 'generic', fullName: 'Business Person', normalizedName: 'business person', role: 'Operations', company: 'General Business LLC', normalizedCompany: 'general business llc', tags: ['business'], notes: 'General business background' },
    ]
    const results = deterministicContactRetriever.search(routeQuery('find me frnds in sales'), salesContacts)
    expect(results.map((result) => result.contact.id)).toEqual(['sales'])
    expect(results[0].reasons.join(' ')).toMatch(/role|tags|notes/u)
  })
  it('returns structured diagnostics for no-match network searches', () => {
    const plan = routeQuery('Who in my network knows quantum cryptography in Germany?')
    const diagnostics = retrievalDiagnostics(plan, contacts)
    expect(diagnostics.status).toBe('NO_MATCHES')
    expect(diagnostics.searchedConcepts).toContain('quantum')
    expect(diagnostics.totalContactsChecked).toBe(3)
    expect(diagnostics.reasonCode).toMatch(/NO_DOMAIN_MATCH|FILTERS_TOO_NARROW/u)
  })
})
