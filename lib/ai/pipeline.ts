import type { AnalyzeContactInput, EvidenceBundle } from '@/lib/ai/types'
import { searchContacts } from '@/lib/tools/contact-search'
import { enrichContacts } from '@/lib/tools/enrichment'
import { extractTarget } from '@/lib/tools/entity-extraction'
import type { WebSearchProvider } from '@/lib/tools/web-search'

/**
 * NetworkMind intelligence pipeline (grounding layer).
 *
 * Data flow:
 *   query
 *     -> extract target entity         (lib/tools/entity-extraction)
 *     -> retrieve relevant contacts    (lib/tools/contact-search)
 *     -> retrieve external information (lib/tools/web-search)
 *     -> verify relationship paths     (lib/tools/relationship-verification)
 *     -> combine evidence + score      (lib/tools/enrichment)
 *     -> EvidenceBundle                (consumed by the LLM reasoning layer)
 *
 * The bundle is the ONLY context the LLM is allowed to reason over, which is
 * what prevents it from inventing people, companies, relationships, or
 * connection paths. This stage performs no LLM calls and is fully testable.
 */
export async function gatherEvidence({
  query,
  contacts,
  limit = 8,
  provider,
}: {
  query: string
  contacts: AnalyzeContactInput[]
  limit?: number
  provider?: WebSearchProvider
}): Promise<EvidenceBundle> {
  const target = extractTarget(query)
  const ranked = searchContacts(query, contacts, { limit })
  const enriched = await enrichContacts(ranked, { provider, target })
  const hasVerifiedPath = enriched.some((entry) => entry.introductionVerified)

  return { query, target, contacts: enriched, hasVerifiedPath }
}

/**
 * Serialise the evidence bundle into the exact JSON the model receives.
 * Kept separate so prompts and routes share one grounded representation.
 */
export function serializeEvidenceForLlm(
  query: string,
  bundle: EvidenceBundle,
): string {
  return JSON.stringify(
    {
      query,
      target: {
        raw: bundle.target.raw,
        type: bundle.target.type,
        requiresVerifiedPath: bundle.target.requiresVerifiedPath,
      },
      hasVerifiedPath: bundle.hasVerifiedPath,
      contacts: bundle.contacts.map((entry) => ({
        contactId: entry.contact.id,
        name: entry.contact.name,
        company: entry.contact.company,
        role: entry.contact.role ?? null,
        location: entry.contact.location ?? null,
        relevance: Number(entry.relevance.toFixed(2)),
        relationshipStrength: entry.relationshipStrength,
        recommendationConfidence: entry.recommendationConfidence,
        introductionVerified: entry.introductionVerified,
        pathEvidence: entry.pathEvidence,
        externalValidation: entry.externalValidation,
        networkEvidence: entry.networkEvidence,
        webEvidence: entry.webEvidence,
      })),
    },
    null,
    2,
  )
}
