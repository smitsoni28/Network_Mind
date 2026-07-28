import type {
  AnalyzeContactInput,
  ConfidenceLabel,
  EnrichedContact,
  NetworkEvidence,
  TargetEntity,
  WebEvidence,
} from '@/lib/ai/types'
import type { ScoredContact } from '@/lib/tools/contact-search'
import { verifyIntroductionPath } from '@/lib/tools/relationship-verification'
import { getWebSearchProvider, type WebSearchProvider } from '@/lib/tools/web-search'

const NO_TARGET: TargetEntity = {
  raw: '',
  normalized: '',
  type: 'none',
  isIntroductionRequest: false,
  requiresVerifiedPath: false,
}

/**
 * Enrichment / evidence-combination stage.
 *
 * Provider independent: it consumes scored contacts from `contact-search` and a
 * `WebSearchProvider` (any implementation) and produces grounded
 * `EnrichedContact` records carrying both private-network and external evidence
 * plus a confidence label. No facts are invented here — every entry is derived
 * from data that was retrieved.
 */

/** Turn a contact's private profile fields into explicit cited evidence. */
export function buildNetworkEvidence(
  contact: AnalyzeContactInput,
): NetworkEvidence[] {
  const evidence: NetworkEvidence[] = []

  if (contact.relationship) {
    const { strength, lastContact, howYouMet, mutualConnections } =
      contact.relationship
    evidence.push({
      source: 'Relationship',
      detail: `${strength} relationship; met via ${howYouMet}; last contact ${lastContact}; ${mutualConnections} mutual connections.`,
    })
  }

  for (const item of contact.known ?? []) {
    evidence.push({ source: 'Network note', detail: item })
  }

  for (const item of contact.insights ?? []) {
    evidence.push({ source: 'Network insight', detail: item })
  }

  if (evidence.length === 0) {
    evidence.push({
      source: 'Network record',
      detail: `${contact.name} — ${contact.role ?? 'unknown role'} at ${contact.company}.`,
    })
  }

  return evidence
}

const STRENGTH_WEIGHT: Record<ConfidenceLabel, number> = {
  Strong: 1,
  Warm: 0.6,
  Cold: 0.3,
}

function labelFor(score: number): ConfidenceLabel {
  if (score >= 70) return 'Strong'
  if (score >= 45) return 'Warm'
  return 'Cold'
}

/**
 * Relationship-relevance blend (private network + retrieval + web validation).
 * This is the baseline used for ecosystem/topic queries where no specific
 * introduction path is required.
 */
export function scoreConfidence(input: {
  relationshipStrength?: ConfidenceLabel
  relevance: number
  externalValidation: boolean
}): { label: ConfidenceLabel; score: number } {
  const strength = STRENGTH_WEIGHT[input.relationshipStrength ?? 'Cold']
  const relevance = Math.min(1, Math.max(0, input.relevance))
  const validation = input.externalValidation ? 1 : 0

  // Weighted blend: relationship and relevance dominate, web validation lifts.
  const composite = strength * 0.45 + relevance * 0.4 + validation * 0.15
  const score = Math.round(composite * 100)
  return { label: labelFor(score), score }
}

/**
 * RECOMMENDATION confidence — deliberately distinct from relationship strength.
 *
 * The decisive rule for fixing the hallucinated-path bug: when the query
 * requires a verified path to a named entity and NO such path exists, the
 * recommendation is Cold regardless of how strong the relationship is. A Warm
 * relationship can therefore yield a Cold recommendation.
 */
export function scoreRecommendation(input: {
  relationshipStrength?: ConfidenceLabel
  relevance: number
  externalValidation: boolean
  requiresVerifiedPath: boolean
  introductionVerified: boolean
}): { label: ConfidenceLabel; score: number } {
  if (input.requiresVerifiedPath && !input.introductionVerified) {
    // Unverified introduction path: cannot recommend as a connection.
    const relevance = Math.min(1, Math.max(0, input.relevance))
    return { label: 'Cold', score: Math.round(relevance * 20) }
  }

  const base = scoreConfidence({
    relationshipStrength: input.relationshipStrength,
    relevance: input.relevance,
    externalValidation: input.externalValidation,
  })

  if (input.requiresVerifiedPath && input.introductionVerified) {
    // A proven path is a strong, grounded signal — lift and never below Warm.
    const score = Math.min(100, Math.max(60, base.score + 15))
    return { label: labelFor(score), score }
  }

  return base
}

/** A company-only mention is never enough to confirm a person's identity. */
export function identityStatus(
  contact: AnalyzeContactInput,
  webEvidence: WebEvidence[],
): 'UNVERIFIED' | 'POSSIBLE_MATCH' | 'CONFIRMED' {
  if (webEvidence.length === 0) return 'UNVERIFIED'
  const name = contact.name.toLocaleLowerCase('und')
  const disambiguators = [contact.company, contact.role, contact.location].filter((value): value is string => !!value && value.length > 1).map((value) => value.toLocaleLowerCase('und'))

  if (webEvidence.some((item) => { const text = `${item.title} ${item.snippet}`.toLocaleLowerCase('und'); return text.includes(name) && disambiguators.some((value) => text.includes(value)) })) return 'CONFIRMED'
  return webEvidence.some((item) => `${item.title} ${item.snippet}`.toLocaleLowerCase('und').includes(name)) ? 'POSSIBLE_MATCH' : 'UNVERIFIED'
}

/**
 * Enrich a ranked set of contacts with external evidence, path verification,
 * and a recommendation confidence that is separate from relationship strength.
 * Web lookups run in parallel and are best-effort; failures degrade to
 * network-only grounding rather than breaking the pipeline.
 */
export async function enrichContacts(
  scored: ScoredContact[],
  options: {
    provider?: WebSearchProvider
    webLimit?: number
    target?: TargetEntity
  } = {},
): Promise<EnrichedContact[]> {
  const provider = options.provider ?? getWebSearchProvider()
  const webLimit = Math.min(options.webLimit ?? 3, 5)
  const target = options.target ?? NO_TARGET

  return Promise.all(
    scored.slice(0, 5).map(async ({ contact, relevance, matchedTerms }) => {
      const networkEvidence = buildNetworkEvidence(contact)

      const webEvidence = await provider.search(
        `${contact.name} ${contact.company} ${contact.role ?? ''} ${contact.location ?? ''}`.trim(),
        { limit: webLimit },
      )

      const status = identityStatus(contact, webEvidence)
      const externalValidation = status === 'CONFIRMED'
      const relationshipStrength: ConfidenceLabel =
        contact.relationship?.strength ?? 'Cold'

      const { verified, pathEvidence } = verifyIntroductionPath(
        contact,
        target,
        webEvidence,
      )

      const { label, score } = scoreRecommendation({
        relationshipStrength,
        relevance,
        externalValidation,
        requiresVerifiedPath: target.requiresVerifiedPath,
        introductionVerified: verified,
      })

      return {
        contact,
        relevance,
        matchedTerms,
        networkEvidence,
        webEvidence,
        externalValidation,
        identityStatus: status,
        relationshipStrength,
        introductionVerified: verified,
        pathEvidence,
        recommendationConfidence: label,
        recommendationScore: score,
      }
    }),
  )
}
