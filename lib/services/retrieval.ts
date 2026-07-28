import type { Contact, ContactEdge, Interaction } from '@prisma/client'
import type { QueryPlan } from '@/lib/services/query-intent'
import { normalizeSearch, tokens } from '@/lib/services/normalization'

export type RetrievalContact = Contact & { interactions?: Interaction[]; outgoingEdges?: ContactEdge[] }
export type RetrievalResult = {
  contact: RetrievalContact
  score: number
  matchedFields: string[]
  reasons: string[]
  exactMatch?: boolean
  inactiveDays?: number
}
export type NoMatchDiagnostics = {
  status: 'NO_MATCHES'
  searchedConcepts: string[]
  filters: {
    geography?: string
    roles?: string[]
    industries?: string[]
    skills?: string[]
  }
  totalContactsChecked: number
  contactsPassingDomainThreshold: number
  contactsExcludedByGeography: number
  contactsWithMissingRelevantFields: number
  reasonCode: 'NO_DOMAIN_MATCH' | 'FILTERS_TOO_NARROW' | 'INSUFFICIENT_CONTACT_DATA' | 'NETWORK_ONLY_BLOCKED_PUBLIC_RESEARCH'
}
export interface ContactRetriever {
  search(plan: QueryPlan, contacts: RetrievalContact[], options?: { limit?: number; threshold?: number; now?: Date }): RetrievalResult[]
}

const GENERIC = new Set(['contact','contacts','network','people','person','someone','experience','help','find','show','know','business','activity','activities','relevant','research','current','latest','trend','trends','market','growth'])
const SYNONYMS: Record<string, string[]> = {
  ai: ['artificial intelligence', 'machine learning', 'ml', 'generative ai', 'llm'],
  ml: ['machine learning', 'ai', 'artificial intelligence'],
  'artificial intelligence': ['ai', 'machine learning', 'ml', 'generative ai', 'llm'],
  vc: ['venture capital', 'investor', 'investment'],
  investor: ['vc', 'venture capital', 'investment'],
  investment: ['investor', 'venture capital', 'vc'],
  fundraising: ['funding', 'investor', 'investment', 'venture capital', 'vc', 'angel', 'fund', 'startup financing'],
  funding: ['fundraising', 'investment', 'investor'],
  fund: ['funding', 'fundraising', 'investor'],
  founder: ['entrepreneur', 'startup'], entrepreneur: ['founder', 'startup'], founders: ['founder', 'entrepreneur', 'startup'],
  startup: ['startups'], startups: ['startup'],
  manufacturing: ['industrial'], industrial: ['manufacturing'],
  advisor: ['consultant'], consultant: ['advisor'],
  sales: ['business development', 'bd', 'account executive', 'account manager', 'sales director', 'sales manager', 'commercial', 'revenue', 'go-to-market', 'gtm', 'partnerships', 'customer acquisition'],
  revenue: ['sales', 'commercial', 'go-to-market', 'gtm'],
  'business development': ['sales', 'bd', 'partnerships'],
}
const LOCATION_SYNONYMS: Record<string, string[]> = {
  dach: ['germany', 'german', 'austria', 'switzerland'], germany: ['german', 'dach', 'berlin', 'munich'], german: ['germany', 'dach', 'berlin', 'munich'], austria: ['dach'], switzerland: ['dach'],
  münchen: ['munich'], munich: ['münchen'],
  france: ['french'], french: ['france'],
}
const WEIGHTS = { edge: 1, role: 0.78, company: 0.74, tags: 0.76, interaction: 0.58, notes: 0.44, name: 0.28 }

function expand(initial: string[], synonyms: Record<string, string[]>): string[] {
  return [...new Set(initial.map(normalizeSearch).filter((term) => term.length > 1 && !GENERIC.has(term)).flatMap((term) => [term, ...(synonyms[term] ?? [])]))]
}

function contains(haystack: string | null | undefined, term: string): boolean {
  if (!haystack) return false
  const normalized = normalizeSearch(haystack)
  return term.includes(' ') ? normalized.includes(term) : tokens(normalized).includes(term)
}

function termsForPlan(plan: QueryPlan) {
  return {
    domainTerms: expand([...plan.domainConcepts, ...plan.roleTerms, ...plan.companyTerms], SYNONYMS),
    locationTerms: expand(plan.locations, LOCATION_SYNONYMS),
  }
}

function relationshipModifier(contact: RetrievalContact): number {
  if (contact.relationshipStrength === 'STRONG') return 0.04
  if (contact.relationshipStrength === 'WARM') return 0.02
  if (contact.relationshipStrength === 'COLD') return -0.01
  return 0
}

function hasRelevantFields(contact: RetrievalContact): boolean {
  return !!(contact.role || contact.company || contact.tags.length || contact.location || contact.notes || contact.interactions?.length || contact.outgoingEdges?.length)
}

function evaluateContact(contact: RetrievalContact, domainTerms: string[], locationTerms: string[]): { result: RetrievalResult | null; domainMatchCount: number; locationMatchCount: number; excludedByGeography: boolean; hasRelevantFields: boolean; score: number } {
  const domainFields: Array<[string, string | null | undefined, number]> = [
    ['role', contact.role, WEIGHTS.role],
    ['company', contact.company, WEIGHTS.company],
    ['tags', contact.tags.join(' '), WEIGHTS.tags],
    ['interaction', contact.interactions?.map((item) => item.summary).join(' '), WEIGHTS.interaction],
    ['notes', contact.notes, WEIGHTS.notes],
    ['edge', contact.outgoingEdges?.map((edge) => `${edge.externalTargetName ?? ''} ${edge.relationshipType} ${edge.evidence}`).join(' '), WEIGHTS.edge],
    ['name', contact.fullName, WEIGHTS.name],
  ]
  const matchedFields: string[] = []
  const reasons: string[] = []
  const matchedDomainTerms = new Set<string>()
  let weighted = 0
  for (const [field, value, weight] of domainFields) {
    const matches = domainTerms.filter((term) => contains(value, term))
    if (matches.length) {
      matchedFields.push(field)
      matches.forEach((term) => matchedDomainTerms.add(term))
      reasons.push(`${field} matches ${[...new Set(matches)].slice(0, 3).join(', ')}`)
      weighted += weight * Math.min(1, matches.length / 2)
    }
  }

  const locationMatches = locationTerms.filter((term) => contains(contact.location, term))
  const locationRequired = locationTerms.length > 0
  const domainRequired = domainTerms.length > 0
  const excludedByGeography = locationRequired && matchedDomainTerms.size > 0 && locationMatches.length === 0
  if ((domainRequired && matchedDomainTerms.size === 0) || excludedByGeography) {
    return { result: null, domainMatchCount: matchedDomainTerms.size, locationMatchCount: locationMatches.length, excludedByGeography, hasRelevantFields: hasRelevantFields(contact), score: 0 }
  }
  if (locationMatches.length) {
    matchedFields.push('location')
    reasons.push(`location matches ${[...new Set(locationMatches)].slice(0, 3).join(', ')}`)
  }
  const coverage = domainRequired ? Math.min(1, matchedDomainTerms.size / Math.max(1, Math.min(4, domainTerms.length))) : 0
  const locationBoost = locationMatches.length ? (domainRequired ? 0.12 : 0.5) : 0
  const multiFieldBoost = Math.max(0, Math.min(0.12, ([...new Set(matchedFields)].length - 1) * 0.06))
  const score = Math.min(1, weighted * 0.55 + coverage * 0.25 + locationBoost + multiFieldBoost + relationshipModifier(contact))
  return { result: { contact, score, matchedFields: [...new Set(matchedFields)], reasons }, domainMatchCount: matchedDomainTerms.size, locationMatchCount: locationMatches.length, excludedByGeography, hasRelevantFields: hasRelevantFields(contact), score }
}

function exactLookup(plan: QueryPlan, contacts: RetrievalContact[]): RetrievalResult[] {
  const normalizedQuery = normalizeSearch(plan.originalQuery)
  const normalizedTarget = plan.targetName ? normalizeSearch(plan.targetName) : null
  const contact = contacts
    .filter((item) => {
      const name = item.normalizedName || normalizeSearch(item.fullName)
      return name === normalizedTarget || (name.includes(' ') && normalizedQuery.includes(name))
    })
    .sort((a, b) => b.fullName.length - a.fullName.length)[0]
  return contact ? [{ contact, score: 1, matchedFields: ['name'], reasons: ['Exact full-name match'], exactMatch: true }] : []
}

export const deterministicContactRetriever: ContactRetriever = {
  search(plan, contacts, options = {}) {
    const threshold = options.threshold ?? Number(process.env.CONTACT_RELEVANCE_THRESHOLD ?? 0.22)
    const limit = options.limit ?? contacts.length
    const now = options.now ?? new Date()

    const exact = exactLookup(plan, contacts)
    if (exact.length && (plan.intent === 'CONTACT_LOOKUP' || plan.intent === 'NETWORK_SEARCH' || plan.intent === 'UNKNOWN')) return exact.slice(0, limit)
    if (plan.intent === 'CONTACT_LOOKUP') return []

    if (plan.intent === 'RECONNECT') {
      const inactiveDays = plan.inactiveDays ?? 90
      const staleBefore = plan.staleBefore ? new Date(plan.staleBefore) : null
      return contacts
        .filter((contact) => {
          if (!contact.lastContactAt) return false
          if (staleBefore) return contact.lastContactAt.getTime() < staleBefore.getTime()
          const days = Math.floor((now.getTime() - contact.lastContactAt.getTime()) / 86_400_000)
          return days >= inactiveDays
        })
        .map((contact) => {
          const days = Math.floor((now.getTime() - contact.lastContactAt!.getTime()) / 86_400_000)
          return { contact, score: Math.min(1, days / Math.max(365, inactiveDays)), matchedFields: ['lastContactAt'], reasons: [`Last contacted ${days} days ago`], inactiveDays: days }
        })
        .sort((a, b) => b.inactiveDays - a.inactiveDays)
        .slice(0, limit)
    }

    const { domainTerms, locationTerms } = termsForPlan(plan)
    if (!domainTerms.length && !locationTerms.length) return []

    return contacts.map((contact) => evaluateContact(contact, domainTerms, locationTerms).result)
      .filter((result): result is RetrievalResult => !!result && result.score >= threshold)
      .sort((a, b) => b.score - a.score || a.contact.fullName.localeCompare(b.contact.fullName))
      .slice(0, limit)
  },
}

export function retrievalDiagnostics(plan: QueryPlan, contacts: RetrievalContact[], options: { threshold?: number; reasonCodeOverride?: NoMatchDiagnostics['reasonCode'] } = {}): NoMatchDiagnostics {
  const threshold = options.threshold ?? Number(process.env.CONTACT_RELEVANCE_THRESHOLD ?? 0.22)
  const { domainTerms, locationTerms } = termsForPlan(plan)
  const evaluations = contacts.map((contact) => evaluateContact(contact, domainTerms, locationTerms))
  const contactsPassingDomainThreshold = evaluations.filter((item) => item.result && item.score >= threshold).length
  const contactsExcludedByGeography = evaluations.filter((item) => item.excludedByGeography).length
  const contactsWithMissingRelevantFields = evaluations.filter((item) => !item.hasRelevantFields).length
  const anyDomainMatch = evaluations.some((item) => item.domainMatchCount > 0)
  const reasonCode = options.reasonCodeOverride
    ?? (!anyDomainMatch ? 'NO_DOMAIN_MATCH'
      : contactsExcludedByGeography > 0 ? 'FILTERS_TOO_NARROW'
        : contactsWithMissingRelevantFields > contacts.length / 2 ? 'INSUFFICIENT_CONTACT_DATA'
          : 'FILTERS_TOO_NARROW')
  return {
    status: 'NO_MATCHES',
    searchedConcepts: [...new Set([...domainTerms, ...locationTerms])].slice(0, 30),
    filters: {
      geography: plan.locations[0],
      roles: plan.roleTerms.length ? plan.roleTerms : undefined,
      industries: plan.domainConcepts.length ? plan.domainConcepts.slice(0, 12) : undefined,
      skills: plan.networkSearch?.concepts.length ? plan.networkSearch.concepts.slice(0, 12) : undefined,
    },
    totalContactsChecked: contacts.length,
    contactsPassingDomainThreshold,
    contactsExcludedByGeography,
    contactsWithMissingRelevantFields,
    reasonCode,
  }
}
