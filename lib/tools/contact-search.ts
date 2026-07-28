import type { AnalyzeContactInput } from '@/lib/ai/types'
import { normalizeSearch, tokens } from '@/lib/services/normalization'

export type ScoredContact = { contact: AnalyzeContactInput; relevance: number; matchedTerms: string[] }
const STOP = new Set(['a','an','and','are','as','at','be','by','can','find','for','from','how','i','in','into','is','it','me','my','of','on','or','that','the','to','who','with','whom','help','need','looking','want','get','someone','people','person','network','contact','contacts','connection','connections','know','show'])
const SYNONYMS: Record<string, string[]> = { vc: ['venture capital','investor'], founder: ['entrepreneur'], manufacturing: ['industrial'], dach: ['germany','austria','switzerland'], advisor: ['consultant'] }

function queryTerms(query: string) {
  const base = tokens(query).filter((term) => term.length > 1 && !STOP.has(term))
  return [...new Set(base.flatMap((term) => [term, ...(SYNONYMS[term] ?? [])]))]
}

export function searchContacts(query: string, contacts: AnalyzeContactInput[], options: { limit?: number; minRelevance?: number } = {}): ScoredContact[] {
  const { limit = 8, minRelevance = 0.2 } = options
  const terms = queryTerms(query)
  if (!terms.length) return []
  return contacts.map((contact) => {
    const weighted: Array<[string, number]> = [
      [contact.role ?? '', 0.8], [contact.company, 0.8], [(contact.insights ?? []).join(' '), 0.7],
      [(contact.known ?? []).join(' '), 0.65], [contact.location ?? '', 0.5], [contact.relationship?.howYouMet ?? '', 0.45], [contact.name, 0.3],
    ]
    let score = 0
    const matchedTerms = new Set<string>()
    for (const [value, weight] of weighted) {
      const text = normalizeSearch(value)
      const matched = terms.filter((term) => term.includes(' ') ? text.includes(term) : tokens(text).includes(term))
      if (matched.length) { matched.forEach((term) => matchedTerms.add(term)); score += weight * Math.min(1, matched.length / terms.length) }
    }
    const coverage = matchedTerms.size / terms.length
    return { contact, relevance: Math.min(1, score * 0.7 + coverage * 0.3), matchedTerms: [...matchedTerms] }
  }).filter((entry) => entry.matchedTerms.length > 0 && entry.relevance >= minRelevance).sort((a, b) => b.relevance - a.relevance).slice(0, limit)
}
