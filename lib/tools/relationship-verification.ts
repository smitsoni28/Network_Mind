import type {
  AnalyzeContactInput,
  PathEvidence,
  TargetEntity,
  WebEvidence,
} from '@/lib/ai/types'

/**
 * Relationship-path verification (provider-independent, deterministic).
 *
 * A contact may only be presented as an introduction path to a target entity
 * when there is EXPLICIT evidence of `contact -> target`. We never infer a path
 * from topical similarity (e.g. "knows AI founders" does NOT imply "knows Elon
 * Musk"). Verification searches only the contact's own relationship facts and
 * retrieved web evidence for a literal mention of the target.
 */

const GENERIC_TOKENS = new Set([
  'inc', 'corp', 'llc', 'ltd', 'the', 'and', 'of', 'co', 'company',
])

function significantTokens(normalized: string): string[] {
  return normalized
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t))
}

/** Does a single text explicitly mention the target entity? */
function mentionsTarget(text: string, target: TargetEntity): boolean {
  const haystack = text.toLowerCase()
  if (!target.normalized) return false

  // Strongest signal: the full target phrase appears verbatim.
  if (haystack.includes(target.normalized)) return true

  // Otherwise require ALL significant tokens of the target to be present,
  // which for multi-word names (e.g. "Elon Musk") avoids matching just "Elon".
  const tokens = significantTokens(target.normalized)
  if (tokens.length < 2) return false
  return tokens.every((token) => new RegExp(`\\b${token}\\b`).test(haystack))
}

function explicitlyDescribesRelationship(text: string): boolean {
  return /\b(knows?|knew|worked (?:directly )?(?:with|for)|reported (?:directly )?to|introduced|connected|colleague|friend|advisor to|invested with|co-?founded|partnered with|in touch with)\b/iu.test(text)
}

export type PathVerification = {
  verified: boolean
  pathEvidence: PathEvidence | null
}

/**
 * Verify whether `contact` has an evidence-backed path to `target`.
 * Only relationship-bearing fields are searched (how you met, network notes,
 * insights, and external web evidence) — never the contact's own role/company,
 * which says nothing about who they can introduce.
 */
export function verifyIntroductionPath(
  contact: AnalyzeContactInput,
  target: TargetEntity,
  webEvidence: WebEvidence[] = [],
): PathVerification {
  if (!target.requiresVerifiedPath) {
    return { verified: false, pathEvidence: null }
  }

  const candidates: PathEvidence[] = []

  if (contact.relationship?.howYouMet) {
    candidates.push({
      source: 'Relationship',
      detail: contact.relationship.howYouMet,
    })
  }
  for (const item of contact.known ?? []) {
    candidates.push({ source: 'Network note', detail: item })
  }
  for (const item of contact.insights ?? []) {
    candidates.push({ source: 'Network insight', detail: item })
  }
  for (const item of webEvidence) {
    candidates.push({
      source: `Web · ${item.source}`,
      detail: item.snippet || item.title,
    })
  }

  for (const candidate of candidates) {
    if (mentionsTarget(candidate.detail, target) && explicitlyDescribesRelationship(candidate.detail)) {
      return { verified: true, pathEvidence: candidate }
    }
  }

  return { verified: false, pathEvidence: null }
}
