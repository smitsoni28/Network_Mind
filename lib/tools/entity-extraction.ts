import type { TargetEntity } from '@/lib/ai/types'

/**
 * Target entity extraction (provider-independent, deterministic).
 *
 * Detects whether a query is an introduction/connection request and, if so,
 * what specific entity the user wants to reach. This is what lets the system
 * distinguish:
 *   "Who can introduce me to Elon Musk?"      -> person target, path required
 *   "Who can introduce me to AI founders?"    -> topic target, no path required
 *   "Who can help me enter AI startups?"      -> not an introduction request
 *
 * Only a SPECIFIC named entity (person/company) forces relationship-path
 * verification. Topics describe an ecosystem and are handled by relevance.
 */

const INTRO_PATTERNS = [
  /\bintroduce\s+me\s+to\s+(.+)$/i,
  /\bintro\s+(?:me\s+)?to\s+(.+)$/i,
  /\bintroduction\s+to\s+(.+)$/i,
  /\bconnect\s+me\s+(?:with|to)\s+(.+)$/i,
  /\bget\s+(?:me\s+)?(?:in\s+touch\s+with|connected\s+(?:with|to))\s+(.+)$/i,
  /\b(?:can|could)\s+(?:i|you)\s+(?:meet|reach)\s+(.+)$/i,
]

// Generic GROUP/ROLE nouns. Their presence means the user is describing an
// ecosystem (a category of people), not a specific named entity — so no
// connection-path verification is required.
const CATEGORY_WORDS = new Set([
  'startup', 'startups', 'founder', 'founders', 'investor', 'investors',
  'vc', 'vcs', 'client', 'clients', 'partner', 'partners', 'people',
  'person', 'someone', 'anyone', 'everyone', 'executives', 'executive',
  'engineers', 'engineer', 'developers', 'developer', 'companies',
  'company', 'firms', 'ceo', 'ceos', 'cto', 'ctos', 'leaders', 'leader',
  'ecosystem', 'industry', 'space', 'market', 'sector', 'community',
  'world', 'scene', 'experts', 'expert', 'professionals', 'advisors',
  'advisor', 'mentors', 'mentor', 'recruiters', 'recruiter', 'managers',
])

// Descriptor words that qualify a topic but are not, by themselves, a named
// entity (e.g. "AI startups", "fintech founders").
const DESCRIPTOR_WORDS = new Set([
  'ai', 'ml', 'tech', 'technology', 'fintech', 'saas', 'biotech', 'crypto',
  'web3', 'gaming', 'healthcare', 'enterprise', 'b2b', 'b2c', 'deep',
  'applied', 'generative', 'data', 'cloud', 'mobile', 'hardware', 'software',
])

const GENERIC_WORDS = new Set([...CATEGORY_WORDS, ...DESCRIPTOR_WORDS])

const TRAILING_NOISE = /[?.!,;:]+$/

const COMPANY_SUFFIXES = [
  'inc', 'corp', 'llc', 'ltd', 'labs', 'capital', 'ventures', 'partners',
  'group', 'technologies', 'systems', 'ai', 'io', 'co',
]

function cleanPhrase(phrase: string): string {
  return phrase
    .replace(TRAILING_NOISE, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

function words(phrase: string): string[] {
  return phrase.split(/\s+/).filter(Boolean)
}

function normToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A phrase is a topic (ecosystem) when it names a CATEGORY of people, or when it
 * contains no specific proper-noun entity at all. A capitalised location (e.g.
 * "Germany") does not make "startup founders in Germany" a named entity.
 */
function isTopic(phrase: string): boolean {
  const tokens = words(phrase).filter((t) => t.length > 1)
  if (tokens.length === 0) return true

  // Any generic group/role noun => ecosystem.
  if (tokens.some((t) => CATEGORY_WORDS.has(normToken(t)))) return true

  // No proper-noun-looking token that isn't generic => not a named entity.
  return !isNamedEntity(phrase)
}

/** Detect a specific named entity (proper-noun-style, non-generic token). */
function isNamedEntity(phrase: string): boolean {
  const tokens = words(phrase)
  const properNouns = tokens.filter(
    (t) => /^[A-Z][A-Za-z'’.-]+$/.test(t) && !GENERIC_WORDS.has(normToken(t)),
  )
  if (properNouns.length === 0) return false
  // If a category word is present, treat the proper noun as a topic qualifier
  // (e.g. "founders in Germany") rather than a target entity.
  return !tokens.some((t) => CATEGORY_WORDS.has(normToken(t)))
}

function classify(phrase: string): 'person' | 'company' | 'topic' {
  if (isTopic(phrase)) return 'topic'

  const tokens = words(phrase)
  const lastLower = normToken(tokens[tokens.length - 1] ?? '')
  if (lastLower && COMPANY_SUFFIXES.includes(lastLower)) return 'company'

  // Two-or-more capitalised tokens that look like a personal name.
  const capitalised = tokens.filter((t) => /^[A-Z]/.test(t))
  if (capitalised.length >= 2) return 'person'

  // Single capitalised token: treat as a company/organisation name.
  return 'company'
}

const NONE: TargetEntity = {
  raw: '',
  normalized: '',
  type: 'none',
  isIntroductionRequest: false,
  requiresVerifiedPath: false,
}

export function extractTarget(query: string): TargetEntity {
  const trimmed = query.trim()
  if (!trimmed) return NONE

  for (const pattern of INTRO_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match?.[1]) {
      const raw = cleanPhrase(match[1])
      if (!raw) continue

      const type = classify(raw)
      return {
        raw,
        normalized: raw.toLowerCase(),
        type,
        isIntroductionRequest: true,
        requiresVerifiedPath: type === 'person' || type === 'company',
      }
    }
  }

  return NONE
}
