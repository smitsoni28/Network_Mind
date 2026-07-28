export type PilotContact = { id: string; fullName: string; company: string | null; role: string | null; location: string | null; relationshipStrength: 'STRONG' | 'WARM' | 'COLD' | 'UNKNOWN'; lastContactAt: string | null; source?: string }
export type EvidenceView = { id: string; type: 'NETWORK' | 'INTERACTION' | 'EDGE' | 'WEB'; source: string; contactId: string | null; title: string | null; detail: string; url: string | null; retrievedAt: string | null; occurredAt: string | null; confidence: number }
export type PilotRecommendation = { id: string; analysisRunId?: string; contact: PilotContact; matchScore: number; relationshipScore: number; evidenceConfidence: number; actionabilityScore: number; priorityScore: number; matchedFields: string[]; reasoning: string; suggestedAction: string; uncertainty: string[]; evidenceIds: string[]; exactMatch?: boolean; inactiveDays?: number | null }
export type PublicSource = { title: string; url: string; snippet: string; source: string; publishedAt?: string | null; retrievedAt?: string }
export type AnalysisResponse = {
  mode: 'DIRECT' | 'CLARIFICATION' | 'WEB' | 'NETWORK' | 'MIXED' | 'VERIFIED_PATH' | 'DRAFT'
  intent: string
  answer: string
  publicProfile?: string | null
  totalMatches: number
  displayedCount: number
  offset: number
  hasMore: boolean
  recommendations: PilotRecommendation[]
  evidence: EvidenceView[]
  sources: PublicSource[]
  topicSources?: PublicSource[]
  contactVerificationSources?: PublicSource[]
  uncertainty: string[]
  searchedAt: string | null
  externalProvidersUsed: string[]
  analysisRunId: string | null
  conversationId?: string
  conversationTitle?: string
  activeTask?: unknown
  pendingClarification?: unknown
  diagnostics?: unknown
}
export type ConversationListItem = { id: string; title: string; createdAt: string; updatedAt: string; archivedAt?: string | null }
export type ConversationHistoryMessage = { id: string; role: 'USER' | 'ASSISTANT'; text: string; messageType: string; intent: string | null; structuredPayload: unknown; createdAt: string }
