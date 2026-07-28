export type ContactRelationship = {
  strength: 'Strong' | 'Warm' | 'Cold'
  lastContact: string
  howYouMet: string
  mutualConnections: number
}

export type LegacyRecommendation = {
  name: string
  company: string
  role: string
  relationship: ContactRelationship
}

export type AnswerCard = {
  name: string
  initials: string
  role: string
  company: string
  reason: string
  via: string
  strength: 'Strong' | 'Warm' | 'Cold'
}

export type AnalyzeContactInput = {
  id: string
  name: string
  email: string
  company: string
  role?: string
  location?: string
  relationship?: ContactRelationship
  known?: string[]
  insights?: string[]
}

export type AiAnalysisRecommendation = {
  contactId: string
  opportunityScore: number
  reasoning: string
  evidence: string[]
  uncertainty: string[]
  suggestedAction: string
}

export type AnalyzeNetworkResponse = {
  recommendations: AiAnalysisRecommendation[]
}

export type ConfidenceLabel = 'Strong' | 'Warm' | 'Cold'

/** A single fact drawn from the user's private network data. */
export type NetworkEvidence = {
  source: string
  detail: string
}

/** A single fact retrieved from an external (web) source. */
export type WebEvidence = {
  title: string
  url: string
  snippet: string
  source: string
  publishedAt?: string | null
  retrievedAt?: string
  provider?: string
}

/**
 * A target entity extracted from the user's query.
 * - `person`/`company`: a specific named entity. An introduction request to one
 *   of these REQUIRES a verified contact -> target path.
 * - `topic`: an ecosystem/theme (e.g. "AI startups"); no path verification.
 * - `none`: no introduction target detected.
 */
export type TargetEntity = {
  raw: string
  normalized: string
  type: 'person' | 'company' | 'topic' | 'none'
  isIntroductionRequest: boolean
  /** True only when an explicit, verifiable path to a named entity is required. */
  requiresVerifiedPath: boolean
}

/** A proven connection between a contact and the requested target entity. */
export type PathEvidence = {
  source: string
  detail: string
}

/**
 * A contact after retrieval + enrichment. This is the grounded unit the LLM is
 * allowed to reason over. The LLM must not introduce any person, company,
 * relationship, or connection path that is not represented here.
 *
 * NOTE: `relationshipStrength` (intrinsic relationship) and
 * `recommendationConfidence` (how confident we are in recommending this contact
 * for THIS query) are intentionally separate and may differ — e.g. a Warm
 * relationship with a Cold recommendation when no verified path exists.
 */
export type EnrichedContact = {
  contact: AnalyzeContactInput
  relevance: number
  matchedTerms: string[]
  networkEvidence: NetworkEvidence[]
  webEvidence: WebEvidence[]
  externalValidation: boolean
  identityStatus: 'UNVERIFIED' | 'POSSIBLE_MATCH' | 'CONFIRMED'
  relationshipStrength: ConfidenceLabel
  introductionVerified: boolean
  pathEvidence: PathEvidence | null
  recommendationConfidence: ConfidenceLabel
  recommendationScore: number
}

/** The full grounded context produced by the intelligence pipeline. */
export type EvidenceBundle = {
  query: string
  target: TargetEntity
  contacts: EnrichedContact[]
  hasVerifiedPath: boolean
}

export type GenerateMessageRequest = {
  goal: string
  contact: Pick<LegacyRecommendation, 'name' | 'company' | 'role'>
  relationship: ContactRelationship
  reasoning: string
  suggestedAction: string
}

export type GenerateMessageResponse = {
  message: string
}

export type AskNetworkResponse = {
  summary: string
  cards: AnswerCard[]
}
