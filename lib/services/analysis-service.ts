import type { ContactEdge, QueryIntent as DatabaseQueryIntent } from '@prisma/client'
import { db } from '@/lib/db'
import { routeQuery, type QueryPlan } from '@/lib/services/query-intent'
import { deterministicContactRetriever, retrievalDiagnostics, type NoMatchDiagnostics, type RetrievalResult } from '@/lib/services/retrieval'
import { makeEvidence, serializeUntrustedEvidence, type EvidenceItem } from '@/lib/services/evidence'
import { relationshipScore, scoreOpportunity } from '@/lib/services/scoring'
import { getWebSearchProvider, type WebSearchProvider } from '@/lib/tools/web-search'
import { normalizeSearch } from '@/lib/services/normalization'
import { runStructuredLlm } from '@/lib/ai/run-llm'
import { WEB_ANSWER_SYSTEM_PROMPT } from '@/lib/ai/prompts'

export const NO_PATH_MESSAGE = 'No verified introduction path found.'
type AnalysisMode = 'DIRECT' | 'WEB' | 'NETWORK' | 'MIXED' | 'VERIFIED_PATH' | 'DRAFT'
type BlockedByModeDiagnostics = {
  status: 'BLOCKED_BY_MODE'
  reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH'
  blockedTool: 'WEB_SEARCH'
  originalQuery: string
  publicResearchTopic: string
}

function isMixedIntent(plan: QueryPlan): boolean {
  return plan.intent === 'MIXED_RESEARCH' || plan.intent === 'MIXED_WEB_NETWORK'
}

function canonicalContact(contact: RetrievalResult['contact']) {
  return { id: contact.id, fullName: contact.fullName, company: contact.company, role: contact.role, location: contact.location, relationshipStrength: contact.relationshipStrength, lastContactAt: contact.lastContactAt?.toISOString() ?? null }
}

function networkEvidence(result: RetrievalResult): EvidenceItem[] {
  const contact = result.contact
  const evidence = result.reasons.map((detail) => makeEvidence({ type: 'NETWORK', source: 'Stored contact record', contactId: contact.id, title: null, detail, url: null, retrievedAt: null, occurredAt: null, confidence: 80 }))
  for (const interaction of contact.interactions ?? []) {
    evidence.push(makeEvidence({ type: 'INTERACTION', source: interaction.source, contactId: contact.id, title: interaction.channel, detail: interaction.summary, url: null, retrievedAt: null, occurredAt: interaction.occurredAt.toISOString(), confidence: 90 }))
  }
  return evidence
}

export function edgeMatches(edge: ContactEdge, targetName: string): boolean {
  return !!edge.verifiedAt && !!edge.externalTargetName && normalizeSearch(edge.externalTargetName) === normalizeSearch(targetName)
}

function edgeEvidence(result: RetrievalResult, targetName: string): EvidenceItem[] {
  return (result.contact.outgoingEdges ?? []).filter((edge) => edgeMatches(edge, targetName)).map((edge) => makeEvidence({ type: 'EDGE', source: edge.source, contactId: result.contact.id, title: edge.relationshipType, detail: edge.evidence, url: null, retrievedAt: null, occurredAt: edge.verifiedAt?.toISOString() ?? null, confidence: 100 }))
}

function webEvidence(sources: Awaited<ReturnType<WebSearchProvider['search']>>): EvidenceItem[] {
  return sources.map((source) => makeEvidence({ type: 'WEB', source: source.source, contactId: null, title: source.title, detail: source.snippet, url: source.url, retrievedAt: source.retrievedAt ?? new Date().toISOString(), occurredAt: source.publishedAt ?? null, confidence: 72 }))
}

async function answerFromWeb(query: string, evidence: EvidenceItem[]) {
  if (!evidence.length) return { answer: 'Current web information could not be retrieved.', evidenceIds: [] as string[], uncertainty: ['Web search returned no usable sources.'] }
  if (!process.env.OPENROUTER_API_KEY) {
    const digest = evidence.slice(0, 3).map((item) => `${item.title ?? item.source}: ${item.detail.slice(0, 220)}`).join(' ')
    return { answer: `Web sources retrieved for this question: ${digest}`, evidenceIds: evidence.slice(0, 3).map((item) => item.id), uncertainty: ['No language model is configured, so this is a source digest rather than a synthesized answer.'] }
  }
  const allowed = new Set(evidence.map((item) => item.id))
  const result = await runStructuredLlm({ system: WEB_ANSWER_SYSTEM_PROMPT, user: serializeUntrustedEvidence(query, evidence, []), role: 'research', validate: (data) => {
    if (!data || typeof data !== 'object') return { ok: false as const, errors: ['Response must be an object'] }
    const item = data as { answer?: unknown; evidenceIds?: unknown; uncertainty?: unknown }
    if (typeof item.answer !== 'string' || !item.answer.trim()) return { ok: false as const, errors: ['answer is required'] }
    if (!Array.isArray(item.evidenceIds) || !item.evidenceIds.every((id) => typeof id === 'string' && allowed.has(id))) return { ok: false as const, errors: ['Unknown evidence ID'] }
    if (!Array.isArray(item.uncertainty) || !item.uncertainty.every((value) => typeof value === 'string')) return { ok: false as const, errors: ['uncertainty is required'] }
    return { ok: true as const, data: { answer: item.answer.trim().slice(0, 6000), evidenceIds: [...new Set(item.evidenceIds as string[])].slice(0, 20), uncertainty: (item.uncertainty as string[]).slice(0, 10) } }
  } })
  return result.ok ? result.data : { answer: 'I found public sources, but could not produce a grounded summary from them. The source list is still shown for review.', evidenceIds: evidence.map((item) => item.id), uncertainty: ['The answer model was unavailable or returned unsupported citations.'] }
}

function recommendationFor(result: RetrievalResult, evidence: EvidenceItem[]) {
  const relationship = relationshipScore(result.contact.relationshipStrength, result.contact.lastContactAt)
  const evidenceConfidence = evidence.some((item) => item.type === 'EDGE') ? 100 : evidence.some((item) => item.type === 'INTERACTION') ? 85 : 72
  const actionability = result.contact.relationshipStrength === 'STRONG' ? 90 : result.contact.relationshipStrength === 'WARM' ? 75 : result.contact.relationshipStrength === 'COLD' ? 48 : 40
  const scores = scoreOpportunity({ match: result.score * 100, relationship, evidence: evidenceConfidence, actionability })
  return { contact: canonicalContact(result.contact), ...scores, matchedFields: result.matchedFields, reasoning: result.reasons.join('; '), suggestedAction: result.contact.relationshipStrength === 'COLD' ? 'Reconnect with a brief, context-aware check-in before making an ask.' : 'Reach out with a specific request tied to the matched experience.', uncertainty: ['Relevance does not prove that this contact knows any named target.'], evidenceIds: evidence.map((item) => item.id), exactMatch: result.exactMatch ?? false, inactiveDays: result.inactiveDays ?? null }
}

function exactContactEvidence(result: RetrievalResult): EvidenceItem[] {
  const contact = result.contact
  const facts = [
    contact.role ? `Role: ${contact.role}` : null,
    contact.company ? `Company: ${contact.company}` : null,
    contact.location ? `Location: ${contact.location}` : null,
    contact.tags.length ? `Tags: ${contact.tags.join(', ')}` : null,
    contact.notes ? `Notes: ${contact.notes.slice(0, 1200)}` : null,
    `Relationship strength: ${contact.relationshipStrength}`,
    contact.lastContactAt ? `Last contacted: ${contact.lastContactAt.toISOString()}` : null,
  ].filter((value): value is string => !!value)
  return facts.map((detail) => makeEvidence({ type: 'NETWORK', source: 'Stored contact record', contactId: contact.id, title: 'Stored contact fact', detail, url: null, retrievedAt: null, occurredAt: contact.lastContactAt?.toISOString() ?? null, confidence: 100 }))
}

function databaseIntent(intent: QueryPlan['intent']): DatabaseQueryIntent {
  if (intent === 'MIXED_RESEARCH') return 'MIXED_WEB_NETWORK'
  if (intent === 'CONTACT_LOOKUP') return 'NETWORK_SEARCH'
  if (intent === 'MESSAGE_DRAFT') return 'UNKNOWN'
  if (intent === 'MIXED_WEB_NETWORK') return 'MIXED_WEB_NETWORK'
  return intent
}

async function persist(workspaceId: string, userId: string, plan: QueryPlan, evidence: EvidenceItem[], recommendations: ReturnType<typeof recommendationFor>[]) {
  return db.$transaction(async (tx) => {
    const run = await tx.analysisRun.create({ data: { workspaceId, query: plan.originalQuery, intent: databaseIntent(plan.intent), status: 'COMPLETED', completedAt: new Date() } })
    if (evidence.length) await tx.evidence.createMany({ data: evidence.slice(0, 100).map((item) => ({ ...item, analysisRunId: run.id, workspaceId, type: item.type, retrievedAt: item.retrievedAt ? new Date(item.retrievedAt) : null, occurredAt: item.occurredAt ? new Date(item.occurredAt) : null })) })
    const stored = []
    for (const recommendation of recommendations.slice(0, 5)) {
      stored.push(await tx.recommendation.create({ data: { analysisRunId: run.id, contactId: recommendation.contact.id, matchScore: recommendation.matchScore, relationshipScore: recommendation.relationshipScore, evidenceConfidence: recommendation.evidenceConfidence, actionabilityScore: recommendation.actionabilityScore, priorityScore: recommendation.priorityScore, reasoning: recommendation.reasoning, suggestedAction: recommendation.suggestedAction, uncertainty: recommendation.uncertainty, evidenceIds: recommendation.evidenceIds } }))
    }
    await tx.auditLog.create({ data: { workspaceId, userId, action: 'ANALYSIS_COMPLETED', metadata: { analysisRunId: run.id, intent: plan.intent, contactCount: recommendations.length, externalProviderUsed: evidence.some((item) => item.type === 'WEB') } } })
    return { runId: run.id, recommendationIds: stored.map((item) => item.id) }
  })
}

function matchAnswer(totalMatches: number, shown: number, offset: number): string {
  if (totalMatches === 0) return 'No relevant contacts found.'
  if (totalMatches === 1) return 'Found 1 relevant contact.'
  if (totalMatches <= 5) return `Found ${totalMatches} relevant contacts.`
  if (offset === 0) return `Found ${totalMatches} relevant contacts. Showing the top ${shown}.`
  return `Found ${totalMatches} relevant contacts. Showing ${offset + 1}–${offset + shown}.`
}

function diagnosticSentence(plan: QueryPlan, diagnostics: NoMatchDiagnostics): string {
  const concepts = diagnostics.searchedConcepts.slice(0, 8).join(', ')
  const geography = diagnostics.filters.geography ? `, with ${diagnostics.filters.geography} as a preference` : ''
  const checked = diagnostics.totalContactsChecked === 1 ? '1 contact' : `${diagnostics.totalContactsChecked} contacts`
  const reason = diagnostics.reasonCode === 'NO_DOMAIN_MATCH'
    ? 'No stored contact fields contained enough of those domain signals.'
    : diagnostics.reasonCode === 'FILTERS_TOO_NARROW'
      ? 'Some signals may exist, but the filters were too narrow for a qualified match.'
      : diagnostics.reasonCode === 'INSUFFICIENT_CONTACT_DATA'
        ? 'Too many contacts are missing role, company, tag, location, notes, or interaction context.'
        : 'Public research was disabled, so only imported contact data was checked.'
  return `I searched ${checked} for ${concepts || plan.originalQuery} signals${geography}. None were a strong enough match for this request. ${reason}`
}

function networkSectionAnswer(plan: QueryPlan, totalMatches: number, shown: number, offset: number, diagnostics: NoMatchDiagnostics | null): string {
  return diagnostics ? diagnosticSentence(plan, diagnostics) : matchAnswer(totalMatches, shown, offset)
}

function mixedAnswer(input: { plan: QueryPlan; publicProfile: string | null; webBlocked: boolean; webUnavailable: boolean; networkText: string; uncertainty: string[] }) {
  const publicText = input.webBlocked
    ? 'Public research is disabled in Network-only mode.'
    : input.publicProfile ?? (input.webUnavailable ? 'Current public research could not be retrieved.' : 'No public-research summary was needed.')
  const uncertainty = input.uncertainty.length ? input.uncertainty.join(' ') : 'Public web evidence and private contact evidence are kept separate; public sources do not prove private relationships.'
  return `Public research\n${publicText}\n\nRelevant people in your network\n${input.networkText}\n\nUncertainty\n${uncertainty}`
}

export async function runAnalysis(input: { workspaceId: string; userId: string; query: string; networkOnly?: boolean; provider?: WebSearchProvider; offset?: number }) {
  const plan = routeQuery(input.query)
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const pageSize = 5
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: input.workspaceId } })
  const provider = input.provider ?? getWebSearchProvider()
  let sources: Awaited<ReturnType<WebSearchProvider['search']>> = []
  let publicEvidence: EvidenceItem[] = []
  let publicProfile: string | null = null

  if (input.networkOnly && plan.intent === 'GENERAL_WEB') {
    const diagnostics: BlockedByModeDiagnostics = { status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH', blockedTool: 'WEB_SEARCH', originalQuery: plan.originalQuery, publicResearchTopic: plan.targetName ?? plan.originalQuery }
    const saved = await persist(input.workspaceId, input.userId, plan, [], [])
    return {
      mode: 'DIRECT' as AnalysisMode,
      intent: 'BLOCKED_BY_MODE',
      answer: `Public research is disabled in Network-only mode. I did not search the web or your contacts for "${plan.originalQuery}". Turn Network-only off to run this public research.`,
      totalMatches: 0,
      displayedCount: 0,
      offset: 0,
      hasMore: false,
      recommendations: [],
      evidence: [],
      sources: [],
      topicSources: [],
      contactVerificationSources: [],
      uncertainty: ['Network-only mode blocks public web research.'],
      searchedAt: null,
      externalProvidersUsed: [],
      analysisRunId: saved.runId,
      diagnostics,
    }
  }

  if (plan.intent === 'MESSAGE_DRAFT') {
    const saved = await persist(input.workspaceId, input.userId, plan, [], [])
    return { mode: 'DRAFT' as AnalysisMode, intent: plan.intent, answer: 'Choose a contact from the recommendations and select Draft message.', totalMatches: 0, displayedCount: 0, offset: 0, hasMore: false, recommendations: [], evidence: [], sources: [], topicSources: [], contactVerificationSources: [], uncertainty: [], searchedAt: null, externalProvidersUsed: [], analysisRunId: saved.runId }
  }

  if (plan.intent === 'GENERAL_WEB') {
    if (!input.networkOnly && workspace.webEnrichmentEnabled) sources = await provider.search(plan.originalQuery, { limit: 6 })
    publicEvidence = webEvidence(sources)
    const webAnswer = await answerFromWeb(plan.originalQuery, publicEvidence)
    const saved = await persist(input.workspaceId, input.userId, plan, publicEvidence, [])
    return { mode: 'WEB' as AnalysisMode, intent: plan.intent, answer: webAnswer.answer, totalMatches: 0, displayedCount: 0, offset: 0, hasMore: false, recommendations: [], evidence: publicEvidence, sources, topicSources: sources, contactVerificationSources: [], uncertainty: webAnswer.uncertainty, searchedAt: sources[0]?.retrievedAt ?? null, externalProvidersUsed: sources.length ? [provider.name] : [], analysisRunId: saved.runId }
  }

  const mixed = isMixedIntent(plan)
  const webBlocked = mixed && !!input.networkOnly
  const blockedDiagnostics: BlockedByModeDiagnostics | null = webBlocked
    ? { status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH', blockedTool: 'WEB_SEARCH', originalQuery: plan.originalQuery, publicResearchTopic: plan.publicResearch?.topic ?? plan.targetName ?? plan.originalQuery }
    : null
  if (mixed && !input.networkOnly && workspace.webEnrichmentEnabled) {
    sources = await provider.search(plan.publicResearch?.topic ?? plan.targetName ?? plan.originalQuery, { limit: 6 })
    publicEvidence = webEvidence(sources)
    publicProfile = sources.length ? (await answerFromWeb(plan.publicResearch?.topic ?? plan.targetName ?? plan.originalQuery, publicEvidence)).answer : null
  }

  const contacts = await db.contact.findMany({ where: { workspaceId: input.workspaceId, archivedAt: null }, include: { interactions: { orderBy: { occurredAt: 'desc' }, take: 5 }, outgoingEdges: true } })
  let allResults = deterministicContactRetriever.search(plan, contacts, { limit: contacts.length })

  if (plan.intent === 'INTRODUCTION_PATH') {
    const target = plan.targetName ?? ''
    allResults = contacts.flatMap((contact) => {
      const matches = contact.outgoingEdges.filter((edge) => edgeMatches(edge, target))
      return matches.length ? [{ contact, score: 1, matchedFields: ['edge'], reasons: [`Verified stored edge to ${target}`] }] : []
    })
    const totalMatches = allResults.length
    const results = allResults.slice(offset, offset + pageSize)
    const evidence = results.flatMap((result) => edgeEvidence(result, target))
    const recommendations = results.map((result) => ({ ...recommendationFor(result, evidence.filter((item) => item.contactId === result.contact.id)), suggestedAction: `Ask ${result.contact.fullName} whether they are comfortable making the verified introduction.` }))
    const saved = await persist(input.workspaceId, input.userId, plan, evidence, recommendations)
    recommendations.forEach((recommendation, index) => Object.assign(recommendation, { id: saved.recommendationIds[index], analysisRunId: saved.runId }))
    return { mode: 'VERIFIED_PATH' as AnalysisMode, intent: plan.intent, answer: recommendations.length ? `Found ${totalMatches} verified introduction ${totalMatches === 1 ? 'path' : 'paths'} to ${target}.` : NO_PATH_MESSAGE, totalMatches, displayedCount: recommendations.length, offset, hasMore: offset + recommendations.length < totalMatches, recommendations, evidence, sources: [], topicSources: [], contactVerificationSources: [], uncertainty: recommendations.length ? [] : ['No verified stored relationship evidence supports this introduction request.'], searchedAt: null, externalProvidersUsed: [], analysisRunId: saved.runId }
  }

  const totalMatches = allResults.length
  const results = allResults.slice(offset, offset + pageSize)
  const privateEvidence = results.flatMap((result) => result.exactMatch ? exactContactEvidence(result) : networkEvidence(result))
  const allEvidence = [...publicEvidence, ...privateEvidence].slice(0, 100)
  const recommendations = results.map((result) => recommendationFor(result, privateEvidence.filter((item) => item.contactId === result.contact.id)))
  const noMatchDiagnostics = totalMatches === 0 && plan.intent !== 'CONTACT_LOOKUP'
    ? retrievalDiagnostics(plan, contacts, { reasonCodeOverride: webBlocked ? 'NETWORK_ONLY_BLOCKED_PUBLIC_RESEARCH' : undefined })
    : null
  const saved = await persist(input.workspaceId, input.userId, plan, allEvidence, recommendations)
  recommendations.forEach((recommendation, index) => Object.assign(recommendation, { id: saved.recommendationIds[index], analysisRunId: saved.runId }))
  const mode: AnalysisMode = mixed && !webBlocked ? 'MIXED' : 'NETWORK'
  const networkText = networkSectionAnswer(plan, totalMatches, recommendations.length, offset, noMatchDiagnostics)
  const uncertainty = sources.length || !mixed ? [] : [webBlocked ? 'The public-research operation was not executed because Network-only mode is enabled.' : 'Current web information could not be retrieved.']
  const answer = plan.intent === 'CONTACT_LOOKUP'
    ? (totalMatches ? 'Exact match found.' : 'No exact contact found.')
    : mixed
      ? mixedAnswer({ plan, publicProfile, webBlocked, webUnavailable: !sources.length, networkText, uncertainty })
      : networkText
  return { mode, intent: plan.intent, answer, publicProfile, totalMatches, displayedCount: recommendations.length, offset, hasMore: offset + recommendations.length < totalMatches, recommendations, evidence: allEvidence, sources, topicSources: sources, contactVerificationSources: [], uncertainty, searchedAt: sources[0]?.retrievedAt ?? null, externalProvidersUsed: sources.length ? [provider.name] : [], analysisRunId: saved.runId, diagnostics: noMatchDiagnostics ?? blockedDiagnostics ?? undefined }
}
