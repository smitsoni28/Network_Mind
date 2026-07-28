import type { AnswerCard, AskNetworkResponse, EvidenceBundle } from '@/lib/ai/types'

const MAX_CARDS = 4

export const NO_PATH_MESSAGE = 'No verified introduction path found.'
export const ADJACENT_MESSAGE =
  'These contacts are relevant to the ecosystem but not verified connections.'

function getInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Deterministically build the answer for an introduction request to a SPECIFIC
 * named entity. This path never calls the LLM, so it cannot hallucinate a
 * connection: a contact is only presented as an introduction path when
 * `introductionVerified` is true (backed by explicit evidence).
 *
 * - If verified paths exist: present them, citing the proving evidence.
 * - Otherwise: return the exact "No verified introduction path found." message
 *   and still surface adjacent, relevant contacts clearly marked as unverified.
 */
export function buildIntroductionAnswer(
  bundle: EvidenceBundle,
): AskNetworkResponse {
  const targetName = bundle.target.raw

  const verified = bundle.contacts
    .filter((entry) => entry.introductionVerified)
    .sort((a, b) => b.recommendationScore - a.recommendationScore)

  if (verified.length > 0) {
    const cards: AnswerCard[] = verified.slice(0, MAX_CARDS).map((entry) => ({
      name: entry.contact.name,
      initials: getInitials(entry.contact.name),
      role: entry.contact.role ?? 'Contact',
      company: entry.contact.company,
      reason:
        entry.pathEvidence?.detail ??
        `Verified connection to ${targetName}.`,
      via: entry.pathEvidence
        ? `Verified path · ${entry.pathEvidence.source}`
        : 'Verified connection',
      // Badge reflects the intrinsic RELATIONSHIP strength, not the
      // recommendation confidence (the two are intentionally separate).
      strength: entry.relationshipStrength,
    }))

    const summary = `Found ${verified.length} verified introduction ${
      verified.length === 1 ? 'path' : 'paths'
    } to ${targetName}.`

    return { summary, cards }
  }

  // No verified path: required message + adjacent (unverified) relevant contacts.
  const adjacent = bundle.contacts
    .slice()
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_CARDS)

  const cards: AnswerCard[] = adjacent.map((entry) => ({
    name: entry.contact.name,
    initials: getInitials(entry.contact.name),
    role: entry.contact.role ?? 'Contact',
    company: entry.contact.company,
    reason: `Relevant to the ${targetName} ecosystem, but no verified path to ${targetName}.`,
    via: 'Not a verified connection',
    strength: entry.relationshipStrength,
  }))

  return {
    summary: `${NO_PATH_MESSAGE} ${ADJACENT_MESSAGE}`,
    cards,
  }
}
