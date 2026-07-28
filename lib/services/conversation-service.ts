import { ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import type { AnalysisResponse, ConversationHistoryMessage, ConversationListItem, PilotRecommendation } from '@/lib/client-types'
import { runAnalysis } from '@/lib/services/analysis-service'
import { normalizeSearch } from '@/lib/services/normalization'
import { routeQuery } from '@/lib/services/query-intent'
import { Prisma } from '@prisma/client'

type TaskType = 'NETWORK_SEARCH' | 'RECONNECT_ANALYSIS' | 'WEB_RESEARCH' | 'MIXED_RESEARCH' | 'INTRODUCTION_PATH' | 'MESSAGE_DRAFT' | 'CONTACT_LOOKUP'
type TaskScope = 'PRIVATE_NETWORK' | 'PUBLIC_WEB' | 'MIXED'
type PendingClarification = {
  slot: string
  question: string
  options?: Array<{ id: string; label: string; value: Record<string, unknown> }>
}
export type ActiveTask = {
  type: TaskType
  topic?: string
  originalQuery: string
  scope: TaskScope
  filters: Record<string, unknown>
  resultId?: string
  orderedResultIds: string[]
  displayedResultIds: string[]
  displayedResults?: Array<{
    contactId: string
    order: number
    name: string
    role: string | null
    company: string | null
    location?: string | null
    matchedFields: string[]
    matchExplanation: string
    relationshipStrength: string
    relevanceScore: number
    priorityScore: number
    lastContactAt: string | null
    dateFields: { lastContactAt: boolean }
  }>
  noMatchDiagnostics?: {
    status: 'NO_MATCHES'
    searchedConcepts: string[]
    filters?: { geography?: string; roles?: string[]; industries?: string[]; skills?: string[] }
    totalContactsChecked: number
    contactsPassingDomainThreshold: number
    contactsExcludedByGeography: number
    contactsWithMissingRelevantFields: number
    reasonCode: string
  }
  blockedOutcome?: {
    status: 'BLOCKED_BY_MODE'
    reasonCode: string
    blockedTool: string
    originalQuery: string
    publicResearchTopic?: string
  }
  missingSlots: string[]
  pendingClarification?: PendingClarification
  pendingAction?: { type: string; parameters: Record<string, unknown> }
  lastUpdatedAt: string
}

type ContextDecision =
  | { kind: 'NONE' }
  | { kind: 'DIRECT'; response: AnalysisResponse; activeTask?: ActiveTask | null; intentSource: string }
  | { kind: 'RUN'; query: string; networkOnly: boolean; offset?: number; update?: Partial<ActiveTask>; intentSource: string }

const CANCEL = /^(?:nah|no|nope|leave it|cancel|not that|forget it)[\s!?.]*$/iu
const AFFIRM = /^(?:yes|yeah|yep|sure|okay|ok|do it|go ahead)[\s!?.]*$/iu
const CONTACT_CORRECTION = /\b(?:meant|mean)\s+(?:contacts?|people|network)|\bnot\s+web\b|\buse\s+my\s+contacts?\b|\bcontacts?\s+you\s+gave\s+me\b|\bpeople\s+from\s+before\b/iu
const RESULT_REFERENCE = /\b(?:those|them|those contacts?|the contacts you gave me|the first one|number two|second person|last person|which one)\b/iu
const WHY_THESE_PEOPLE = /\b(?:why these people|why those people|why these contacts|why those contacts)\b/iu
const STRONGEST_REFERENCE = /\b(?:which one is strongest|strongest one|best one|highest priority|top one)\b/iu
const DRAFT_RESULT_REFERENCE = /\b(?:draft|write|compose)\b[\s\S]{0,80}\b(?:message|email|linkedin|text|sms)\b[\s\S]{0,80}\b(?:first|second|third|fourth|fifth|\d+)(?:st|nd|rd|th)?\s+(?:person|contact|one)?\b|\b(?:draft|write|compose)\b[\s\S]{0,80}\b(?:first|second|third|fourth|fifth|\d+)(?:st|nd|rd|th)?\s+(?:person|contact|one)\b/iu
const EXCLUSION_REFINEMENT = /\b(?:not|no|exclude|without)\s+(consultants?|advisors?|investors?|founders?|sales|marketing|engineers?)\b/iu
const LOCATION_REFINEMENT = /\b(?:only|just|filter to|show only)\s+([a-z][\p{L}\p{N}\s-]{1,40})\b/iu
const GO_BACK_PREVIOUS = /\b(?:go back|back)\s+(?:to\s+)?(?:the\s+)?previous\s+(?:search|result|results|list)\b/iu
const YEAR_REFERENCE = /\bwhich\s+year\s+(?:are|were)\s+those\b|\byear\s+are\s+those\b/iu
const YEAR_REFINEMENT = /\b(?:narrow|filter|down|latest|recent|year|within the last year|one year|a year)\b/iu
const SHOW_MORE = /\bshow more|more results|who else|any others\b/iu
// Legacy topic extraction only: this may populate metadata, but must not rewrite the user's query.
const PRIVATE_TOPIC = /\b(?:people|ppl|contacts?|professionals?|founders?|investors?|engineers?|marketers?|anyone)\b[\s\S]{0,80}\b(?:in|with|working in|work in|for)\s+([a-z][\p{L}\p{N}\s-]{1,80})/iu
const DIRECT_SMALLTALK = /^(?:hi|hello|hey|yo|thanks?|thank you|how are you)[\s!?.]*$/iu
const LOW_INFORMATION_TURN = /^(?:bro|cool|ok|okay|k|y|yes|yeah|yep|yo(?:\s+yo)?(?:\s+wassup)?|wassup|sup|lol|lmao|haha|nice|great|got it|roger)[\s!?.]*$/iu
const EXPLAIN_PREVIOUS = /^(?:why|why\?|how come|explain|explain that|what happened)[\s!?.]*$/iu
const CRITICISM = /\b(?:wtf|seriously|asshole|stupid|dumb|u dumb|wrong|bad|useless|makes no sense|this makes no sense|serious|really)\b/iu

function nowIso() { return new Date().toISOString() }
function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
function parseTask(value: unknown): ActiveTask | null {
  return value && typeof value === 'object' && 'type' in value ? value as ActiveTask : null
}
function parseHistory(value: unknown): ActiveTask[] {
  return Array.isArray(value) ? value.filter((item): item is ActiveTask => !!item && typeof item === 'object' && 'type' in item) : []
}
function directResponse(answer: string, intent: string, mode: AnalysisResponse['mode'] = 'DIRECT', task?: ActiveTask | null): AnalysisResponse {
  return { mode, intent, answer, totalMatches: 0, displayedCount: 0, offset: 0, hasMore: false, recommendations: [], evidence: [], sources: [], topicSources: [], contactVerificationSources: [], uncertainty: [], searchedAt: null, externalProvidersUsed: [], analysisRunId: null, activeTask: task ?? null, pendingClarification: task?.pendingClarification ?? null }
}
function meaningfulTitle(question: string): string {
  const normalized = normalizeSearch(question)
  if (/^(hi|hello|hey|yo|how are you|thanks|thank you)$/u.test(normalized)) return 'New conversation'
  const topic = question.match(/\b(?:people|ppl|contacts?)\s+(?:in|with|working in|work in)\s+(.+?)[?!.]*$/iu)?.[1]
  if (topic) return `${topic.trim().replace(/\b\w/gu, (c) => c.toUpperCase())} contacts`.slice(0, 60)
  return question.replace(/[?!.]+$/u, '').slice(0, 60) || 'New conversation'
}
function topicFromText(question: string): string | undefined {
  const match = question.match(PRIVATE_TOPIC)?.[1] ?? question.match(/\b(?:marketing|ai|manufacturing|fundraising|healthcare|energy|fintech)\b/iu)?.[0]
  return match ? normalizeSearch(match).replace(/\bcontacts?\b/gu, '').trim() : undefined
}
function displayedMetadata(recommendations: PilotRecommendation[]) {
  return recommendations.map((item, index) => ({
    contactId: item.contact.id,
    order: index + 1,
    name: item.contact.fullName,
    role: item.contact.role,
    company: item.contact.company,
    location: item.contact.location,
    matchedFields: item.matchedFields,
    matchExplanation: item.reasoning,
    relationshipStrength: item.contact.relationshipStrength,
    relevanceScore: item.matchScore,
    priorityScore: item.priorityScore,
    lastContactAt: item.contact.lastContactAt,
    dateFields: { lastContactAt: !!item.contact.lastContactAt },
  }))
}
function parseNoMatchDiagnostics(value: unknown): ActiveTask['noMatchDiagnostics'] | undefined {
  if (!value || typeof value !== 'object' || (value as { status?: unknown }).status !== 'NO_MATCHES') return undefined
  const item = value as ActiveTask['noMatchDiagnostics']
  return Array.isArray(item?.searchedConcepts) ? item : undefined
}
function parseBlockedOutcome(value: unknown): ActiveTask['blockedOutcome'] | undefined {
  if (!value || typeof value !== 'object' || (value as { status?: unknown }).status !== 'BLOCKED_BY_MODE') return undefined
  const item = value as { reasonCode?: unknown; blockedTool?: unknown; originalQuery?: unknown; publicResearchTopic?: unknown }
  return {
    status: 'BLOCKED_BY_MODE',
    reasonCode: typeof item.reasonCode === 'string' ? item.reasonCode : 'NETWORK_ONLY_PUBLIC_RESEARCH',
    blockedTool: typeof item.blockedTool === 'string' ? item.blockedTool : 'WEB_SEARCH',
    originalQuery: typeof item.originalQuery === 'string' ? item.originalQuery : '',
    publicResearchTopic: typeof item.publicResearchTopic === 'string' ? item.publicResearchTopic : undefined,
  }
}
function taskFromResponse(query: string, response: AnalysisResponse, previous?: ActiveTask | null, update: Partial<ActiveTask> = {}): ActiveTask | null {
  const type: TaskType | null = response.intent === 'NETWORK_SEARCH' ? 'NETWORK_SEARCH'
    : response.intent === 'RECONNECT' ? 'RECONNECT_ANALYSIS'
      : response.intent === 'GENERAL_WEB' ? 'WEB_RESEARCH'
        : response.intent === 'MIXED_WEB_NETWORK' || response.intent === 'MIXED_RESEARCH' ? 'MIXED_RESEARCH'
          : response.intent === 'INTRODUCTION_PATH' ? 'INTRODUCTION_PATH'
            : response.intent === 'CONTACT_LOOKUP' ? 'CONTACT_LOOKUP'
              : response.intent === 'MESSAGE_DRAFT' ? 'MESSAGE_DRAFT'
                : response.intent === 'BLOCKED_BY_MODE' ? 'WEB_RESEARCH'
                : null
  if (!type) return previous ?? null
  const topic = update.topic ?? topicFromText(query) ?? previous?.topic
  return {
    type,
    topic,
    originalQuery: previous?.originalQuery && update.originalQuery === undefined ? previous.originalQuery : query,
    scope: type === 'WEB_RESEARCH' ? 'PUBLIC_WEB' : type === 'MIXED_RESEARCH' ? 'MIXED' : 'PRIVATE_NETWORK',
    filters: { ...(previous?.filters ?? {}), ...(update.filters ?? {}) },
    resultId: response.analysisRunId ?? previous?.resultId,
    orderedResultIds: response.recommendations.map((item) => item.contact.id),
    displayedResultIds: response.recommendations.map((item) => item.contact.id),
    displayedResults: displayedMetadata(response.recommendations),
    noMatchDiagnostics: parseNoMatchDiagnostics(response.diagnostics),
    blockedOutcome: parseBlockedOutcome(response.diagnostics) ?? (response.intent === 'BLOCKED_BY_MODE' ? { status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH', blockedTool: 'WEB_SEARCH', originalQuery: query } : undefined),
    missingSlots: [],
    pendingClarification: update.pendingClarification,
    pendingAction: update.pendingAction,
    lastUpdatedAt: nowIso(),
  }
}
function oneYearClarification(task: ActiveTask): ActiveTask {
  const lastYear = new Date()
  lastYear.setFullYear(lastYear.getFullYear() - 1)
  return {
    ...task,
    pendingClarification: {
      slot: 'contactTimeFilter',
      question: 'Do you mean marketing contacts you have not contacted for at least one year, or contacts you interacted with during the last year?',
      options: [
        { id: 'inactive_one_year', label: 'Not contacted for at least one year', value: { inactivityDays: 365 } },
        { id: 'contacted_last_year', label: 'Contacted during the last year', value: { lastContactFrom: lastYear.toISOString() } },
      ],
    },
    lastUpdatedAt: nowIso(),
  }
}
function answerYearReference(task: ActiveTask): AnalysisResponse {
  const results = task.displayedResults ?? []
  const years = [...new Set(results.map((item) => item.lastContactAt ? new Date(item.lastContactAt).getFullYear() : null).filter((value): value is number => typeof value === 'number' && !Number.isNaN(value)))].sort()
  const answer = years.length
    ? `Those contacts were not selected by year. They matched ${task.topic ?? 'the previous network search'} fields. Their latest recorded contact years range from ${years[0]} to ${years[years.length - 1]}.`
    : `The search was not based on a year. It matched ${task.topic ?? 'the previous network search'}-related fields, and these displayed contacts do not all have usable last-contact years. I can filter them by last-contact year if that is what you mean.`
  return directResponse(answer, 'RESULT_REFERENCE', 'DIRECT', task)
}
function summarizeDisplayedContacts(task: ActiveTask): AnalysisResponse {
  const names = (task.displayedResults ?? []).slice(0, 5).map((item) => item.name)
  const answer = names.length
    ? `You were referring to the contacts I just showed: ${names.join(', ')}. I will keep that previous ${task.topic ?? 'contact'} list as the active context.`
    : 'You were referring to the previous contact list, but I do not have displayed contacts stored for it anymore.'
  return directResponse(answer, 'RESULT_REFERENCE', 'DIRECT', task)
}
function explainPreviousResult(task: ActiveTask, challenge: boolean): AnalysisResponse {
  if (task.blockedOutcome) {
    const topic = task.blockedOutcome.publicResearchTopic || task.blockedOutcome.originalQuery || task.originalQuery
    const answer = `Public research for "${topic}" was blocked because Network-only mode was on. I did not run web research for that turn.`
    return directResponse(answer, challenge ? 'CHALLENGE_PREVIOUS_RESULT' : 'EXPLAIN_PREVIOUS_RESULT', 'DIRECT', task)
  }
  const diagnostics = task.noMatchDiagnostics
  if (diagnostics) {
    const concepts = diagnostics.searchedConcepts.slice(0, 8).join(', ')
    const geography = diagnostics.filters?.geography ? `, with ${diagnostics.filters.geography} as a preference` : ''
    const checked = diagnostics.totalContactsChecked === 1 ? '1 contact' : `${diagnostics.totalContactsChecked} contacts`
    const prefix = challenge ? 'You are right to question it.' : 'Here is why.'
    const answer = `${prefix} I searched ${checked} for ${concepts || task.topic || 'the previous request'} signals${geography}, but none were a strong enough match. It should not simply repeat the same empty search; the useful next step is to loosen the filter or add more role, company, tag, location, or note context to the imported contacts.`
    return directResponse(answer, challenge ? 'CHALLENGE_PREVIOUS_RESULT' : 'EXPLAIN_PREVIOUS_RESULT', 'DIRECT', task)
  }
  const names = (task.displayedResults ?? []).slice(0, 5).map((item) => `${item.name} matched ${item.matchedFields.join(', ') || 'stored contact fields'}`)
  const answer = names.length
    ? `${challenge ? 'I hear you.' : 'Here is why those appeared.'} ${names.join('; ')}. Public evidence was not used as proof of a private relationship.`
    : `${challenge ? 'I hear the frustration.' : 'There is not enough stored result detail to explain the previous answer precisely.'} I will not rerun the search unless you ask for a refinement.`
  return directResponse(answer, challenge ? 'CHALLENGE_PREVIOUS_RESULT' : 'EXPLAIN_PREVIOUS_RESULT', 'DIRECT', task)
}

function strongestDisplayedContact(task: ActiveTask): AnalysisResponse {
  const strongest = (task.displayedResults ?? []).slice().sort((a, b) => b.priorityScore - a.priorityScore || b.relevanceScore - a.relevanceScore)[0]
  const matched = strongest?.matchedFields.length ? `stored ${strongest.matchedFields.join(', ')}` : 'stored contact fields'
  const relationship = strongest?.relationshipStrength ? strongest.relationshipStrength.toLowerCase() : 'available'
  const answer = strongest
    ? `${strongest.name} is strongest in the displayed results because ${matched} matched the request well and the relationship is ${relationship}.`
    : 'I do not have a displayed contact list to rank yet.'
  return directResponse(answer, 'RESULT_REFERENCE', 'DIRECT', task)
}

function referencedResultIndex(question: string): number | null {
  const normalized = normalizeSearch(question)
  const word = normalized.match(/\b(first|second|third|fourth|fifth)\b/u)?.[1]
  if (word) return { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 }[word as 'first' | 'second' | 'third' | 'fourth' | 'fifth']
  const digit = normalized.match(/\b(\d+)(?:st|nd|rd|th)?\b/u)?.[1]
  return digit ? Math.max(0, Number(digit) - 1) : null
}

function draftForReferencedContact(question: string, task: ActiveTask): AnalysisResponse | null {
  const index = referencedResultIndex(question)
  if (index == null) return null
  const contact = (task.displayedResults ?? [])[index]
  if (!contact) return directResponse('I do not have that contact number in the displayed results.', 'MESSAGE_DRAFT', 'DRAFT', task)
  const company = contact.company ? ` at ${contact.company}` : ''
  const context = contact.matchExplanation || `your ${task.topic ?? 'previous'} search`
  const answer = `Draft for ${contact.name}\n\nHi ${contact.name.split(' ')[0]}, I was thinking of you because ${context}. Would you be open to a quick conversation next week?`
  return directResponse(answer, 'MESSAGE_DRAFT', 'DRAFT', { ...task, pendingAction: { type: 'MESSAGE_DRAFT', parameters: { contactName: contact.name, role: contact.role, company } }, lastUpdatedAt: nowIso() })
}

function refineDisplayedResults(question: string, task: ActiveTask): { response: AnalysisResponse; task: ActiveTask } | null {
  const exclusion = question.match(EXCLUSION_REFINEMENT)?.[1]
  const location = question.match(LOCATION_REFINEMENT)?.[1]
  if (!exclusion && !location) return null
  const normalizedExclusion = exclusion ? normalizeSearch(exclusion).replace(/s$/u, '') : null
  const normalizedLocation = location ? normalizeSearch(location) : null
  const source = task.displayedResults ?? []
  const filtered = source.filter((item) => {
    const haystack = normalizeSearch([item.role, item.company, item.location, item.matchExplanation, item.matchedFields.join(' ')].filter(Boolean).join(' '))
    if (normalizedExclusion && haystack.includes(normalizedExclusion)) return false
    if (normalizedLocation && item.location && !normalizeSearch(item.location).includes(normalizedLocation)) return false
    return true
  })
  const refined: ActiveTask = {
    ...task,
    displayedResults: filtered,
    displayedResultIds: filtered.map((item) => item.contactId),
    orderedResultIds: filtered.map((item) => item.contactId),
    filters: { ...task.filters, ...(normalizedExclusion ? { exclude: normalizedExclusion } : {}), ...(normalizedLocation ? { location: normalizedLocation } : {}) },
    lastUpdatedAt: nowIso(),
  }
  const names = filtered.map((item) => item.name).join(', ')
  const answer = filtered.length
    ? `I filtered the displayed results. Remaining contacts: ${names}.`
    : 'I filtered the displayed results, and none of the currently shown contacts remain.'
  return { response: directResponse(answer, 'TASK_REFINEMENT', 'DIRECT', refined), task: refined }
}

function casualResponse(question: string, activeTask: ActiveTask | null): AnalysisResponse {
  const normalized = normalizeSearch(question)
  const answer = normalized.includes('smart')
    ? 'I can search your contacts, explain prior matches, draft outreach, and keep public research separate from private-network evidence.'
    : activeTask
      ? 'Got it. I will keep the last result in context.'
      : 'I am here. I can search contacts, explain results, draft outreach, or run public research when you ask.'
  return directResponse(answer, 'CASUAL_OR_META', 'DIRECT', activeTask)
}
function resolveContext(question: string, activeTask: ActiveTask | null, taskHistory: ActiveTask[]): ContextDecision {
  const normalized = question.normalize('NFKC').trim()
  if (CANCEL.test(normalized)) return { kind: 'DIRECT', response: directResponse('No problem. What would you like to look for instead?', 'CANCEL_PENDING', 'DIRECT', activeTask ? { ...activeTask, pendingAction: undefined, pendingClarification: undefined, lastUpdatedAt: nowIso() } : null), activeTask: activeTask ? { ...activeTask, pendingAction: undefined, pendingClarification: undefined, lastUpdatedAt: nowIso() } : null, intentSource: 'PENDING_ACTION' }
  if (activeTask?.pendingClarification) {
    if (/latest|last year|recent|contacted/i.test(normalized)) {
      const value = activeTask.pendingClarification.options?.find((item) => item.id === 'contacted_last_year')?.value ?? {}
      return { kind: 'RUN', query: activeTask.originalQuery, networkOnly: true, update: { filters: value, pendingClarification: undefined }, intentSource: 'PENDING_CLARIFICATION' }
    }
    if (/inactive|not contacted|one year|year/i.test(normalized) || AFFIRM.test(normalized)) {
      const value = activeTask.pendingClarification.options?.find((item) => item.id === 'inactive_one_year')?.value ?? { inactivityDays: 365 }
      return { kind: 'RUN', query: activeTask.originalQuery, networkOnly: true, update: { filters: value, pendingClarification: undefined }, intentSource: 'PENDING_CLARIFICATION' }
    }
  }
  if (activeTask && EXPLAIN_PREVIOUS.test(normalized)) return { kind: 'DIRECT', response: explainPreviousResult(activeTask, false), activeTask, intentSource: 'EXPLAIN_PREVIOUS_RESULT' }
  if (activeTask && CRITICISM.test(normalized)) return { kind: 'DIRECT', response: explainPreviousResult(activeTask, true), activeTask, intentSource: 'CHALLENGE_PREVIOUS_RESULT' }
  if (CONTACT_CORRECTION.test(normalized)) {
    const restored = [activeTask, ...taskHistory].find((item): item is ActiveTask => !!item && item.scope === 'PRIVATE_NETWORK')
    const task = restored ?? activeTask
    if (task?.type === 'NETWORK_SEARCH') {
      const clarified = YEAR_REFINEMENT.test(task.originalQuery) ? oneYearClarification(task) : task
      const answer = clarified.pendingClarification
        ? `Got it—you meant the ${clarified.topic ?? 'previous'} contacts from your network. ${clarified.pendingClarification.question}`
        : `Got it—you meant the ${clarified.topic ?? 'previous'} contacts from your network. I restored that contact-search context.`
      return { kind: 'DIRECT', response: directResponse(answer, 'CORRECT_PREVIOUS_INTERPRETATION', clarified.pendingClarification ? 'CLARIFICATION' : 'DIRECT', clarified), activeTask: clarified, intentSource: 'CORRECTION' }
    }
  }
  if (activeTask && YEAR_REFERENCE.test(normalized)) return { kind: 'DIRECT', response: answerYearReference(activeTask), activeTask, intentSource: 'RESULT_REFERENCE' }
  if (activeTask && RESULT_REFERENCE.test(normalized)) return { kind: 'DIRECT', response: summarizeDisplayedContacts(activeTask), activeTask, intentSource: 'RESULT_REFERENCE' }
  if (activeTask?.type === 'NETWORK_SEARCH' && YEAR_REFINEMENT.test(normalized)) {
    const clarified = oneYearClarification(activeTask)
    return { kind: 'DIRECT', response: directResponse(clarified.pendingClarification!.question, 'CLARIFICATION_REQUIRED', 'CLARIFICATION', clarified), activeTask: clarified, intentSource: 'TASK_REFINEMENT' }
  }
  const topic = topicFromText(normalized)
  if (topic && /\b(?:thinking about|connect|connecting|people|ppl|contacts?)\b/iu.test(normalized)) {
    return { kind: 'RUN', query: question, networkOnly: true, update: { topic, filters: {}, originalQuery: question }, intentSource: activeTask ? 'TOPIC_SWITCH' : 'EXPLICIT_PRODUCT_ACTION' }
  }
  if (activeTask && SHOW_MORE.test(normalized)) return { kind: 'RUN', query: activeTask.originalQuery, networkOnly: activeTask.scope === 'PRIVATE_NETWORK', intentSource: 'TASK_REFINEMENT' }
  if (DIRECT_SMALLTALK.test(normalized)) return { kind: 'DIRECT', response: directResponse("Hey — what would you like to explore in your network?", 'CASUAL_CHAT'), activeTask, intentSource: 'DIRECT_FAST_PATH' }
  if (CRITICISM.test(normalized)) return { kind: 'DIRECT', response: directResponse('I hear the frustration. Tell me what you want changed and I will keep it grounded in your stored contacts and clearly labelled web evidence.', 'CASUAL_OR_META'), activeTask, intentSource: 'CASUAL_OR_META' }
  return { kind: 'NONE' }
}

function resolveContextHardened(question: string, activeTask: ActiveTask | null, taskHistory: ActiveTask[]): ContextDecision {
  const normalized = question.normalize('NFKC').trim()
  if (activeTask?.pendingClarification) return resolveContext(question, activeTask, taskHistory)
  if (CANCEL.test(normalized)) {
    const cleared = activeTask ? { ...activeTask, pendingAction: undefined, pendingClarification: undefined, lastUpdatedAt: nowIso() } : null
    return { kind: 'DIRECT', response: directResponse('No problem. I cleared that pending step and kept the prior context.', 'CANCEL_PENDING', 'DIRECT', cleared), activeTask: cleared, intentSource: 'PENDING_ACTION' }
  }
  if (LOW_INFORMATION_TURN.test(normalized) || /^(?:are\s+you\s+smart\s+now)[\s?!.]*$/iu.test(normalized) || DIRECT_SMALLTALK.test(normalized)) {
    return { kind: 'DIRECT', response: casualResponse(normalized, activeTask), activeTask, intentSource: 'CASUAL_OR_META' }
  }
  if (activeTask && DRAFT_RESULT_REFERENCE.test(normalized)) {
    const draft = draftForReferencedContact(normalized, activeTask)
    if (draft) return { kind: 'DIRECT', response: draft, activeTask: draft.activeTask as ActiveTask, intentSource: 'RESULT_REFERENCE' }
  }
  if (GO_BACK_PREVIOUS.test(normalized)) {
    const restored = taskHistory[0]
    if (restored) return { kind: 'DIRECT', response: directResponse(`Restored the previous ${restored.topic ?? 'search'} context.`, 'RESULT_REFERENCE', 'DIRECT', restored), activeTask: restored, intentSource: 'RESULT_REFERENCE' }
  }
  if (activeTask && WHY_THESE_PEOPLE.test(normalized)) return { kind: 'DIRECT', response: explainPreviousResult(activeTask, false), activeTask, intentSource: 'RESULT_REFERENCE' }
  if (activeTask && STRONGEST_REFERENCE.test(normalized)) return { kind: 'DIRECT', response: strongestDisplayedContact(activeTask), activeTask, intentSource: 'RESULT_REFERENCE' }
  if (activeTask) {
    const refined = refineDisplayedResults(normalized, activeTask)
    if (refined) return { kind: 'DIRECT', response: refined.response, activeTask: refined.task, intentSource: 'TASK_REFINEMENT' }
  }
  if (activeTask && SHOW_MORE.test(normalized)) {
    return { kind: 'RUN', query: activeTask.originalQuery, networkOnly: activeTask.scope !== 'PUBLIC_WEB', offset: activeTask.displayedResultIds.length, intentSource: 'TASK_REFINEMENT' }
  }
  const freshPlan = routeQuery(normalized)
  if (freshPlan.intent === 'GENERAL_WEB' || freshPlan.intent === 'MIXED_RESEARCH' || freshPlan.intent === 'MIXED_WEB_NETWORK') {
    return { kind: 'NONE' }
  }
  return resolveContext(question, activeTask, taskHistory)
}

async function resolveConversation(workspaceId: string, userId: string, question: string, conversationId?: string) {
  if (conversationId) {
    const existing = await db.conversation.findFirst({ where: { id: conversationId, workspaceId, archivedAt: null } })
    if (!existing) throw new ApiError(404, 'Conversation not found')
    return existing
  }
  return db.conversation.create({ data: { workspaceId, createdByUserId: userId, title: meaningfulTitle(question), taskHistory: [] } })
}
async function persistTurn(input: { workspaceId: string; userId: string; conversationId: string; question: string; response: AnalysisResponse; activeTask: ActiveTask | null; previousTask: ActiveTask | null; previousHistory: ActiveTask[]; title: string }) {
  const changedTask = !!input.previousTask && !!input.activeTask && (input.previousTask.type !== input.activeTask.type || (!!input.previousTask.topic && !!input.activeTask.topic && input.previousTask.topic !== input.activeTask.topic))
  const history = changedTask
    ? [input.previousTask, ...input.previousHistory].slice(0, 5)
    : input.previousHistory
  await db.$transaction(async (tx) => {
    await tx.conversationMessage.create({ data: { conversationId: input.conversationId, workspaceId: input.workspaceId, userId: input.userId, role: 'USER', text: input.question, intent: null, messageType: 'TEXT' } })
    await tx.conversationMessage.create({ data: { conversationId: input.conversationId, workspaceId: input.workspaceId, role: 'ASSISTANT', text: input.response.answer, intent: input.response.intent, messageType: input.response.mode === 'CLARIFICATION' ? 'CLARIFICATION' : input.response.recommendations.length || input.response.evidence.length ? 'TOOL_RESULT' : 'TEXT', structuredPayload: inputJson({ response: input.response }) } })
    await tx.conversation.update({ where: { id: input.conversationId }, data: { activeTask: input.activeTask ? inputJson(input.activeTask) : Prisma.JsonNull, taskHistory: inputJson(history), title: input.title, lastAnalysisRunId: input.response.analysisRunId ?? undefined } })
  })
}

export async function handleAskConversation(input: { workspaceId: string; userId: string; question: string; conversationId?: string; networkOnly?: boolean; offset?: number }) {
  const started = Date.now()
  const conversation = await resolveConversation(input.workspaceId, input.userId, input.question, input.conversationId)
  const previousTask = parseTask(conversation.activeTask)
  const previousHistory = parseHistory(conversation.taskHistory)
  const decision = input.offset ? { kind: 'RUN', query: previousTask?.originalQuery ?? input.question, networkOnly: input.networkOnly ?? previousTask?.scope !== 'PUBLIC_WEB', offset: input.offset, intentSource: 'TASK_REFINEMENT' } as ContextDecision : resolveContextHardened(input.question, previousTask, previousHistory)
  let response: AnalysisResponse
  let activeTask: ActiveTask | null
  let toolCalled: string | null = null
  const intentSource = decision.kind === 'NONE' ? 'SEMANTIC_PLANNER' : decision.intentSource
  const conversationTitle = !input.conversationId || conversation.title === 'New conversation' ? meaningfulTitle(input.question) : conversation.title
  if (decision.kind === 'DIRECT') {
    response = decision.response
    activeTask = decision.activeTask ?? previousTask
  } else {
    const query = decision.kind === 'RUN' ? decision.query : input.question
    const networkOnly = decision.kind === 'RUN' ? decision.networkOnly : input.networkOnly
    const offset = decision.kind === 'RUN' ? decision.offset ?? input.offset : input.offset
    response = await runAnalysis({ workspaceId: input.workspaceId, userId: input.userId, query, networkOnly, offset }) as AnalysisResponse
    activeTask = taskFromResponse(query, response, previousTask, decision.kind === 'RUN' ? decision.update ?? {} : { originalQuery: query })
    toolCalled = response.mode
  }
  response = { ...response, conversationId: conversation.id, conversationTitle, activeTask, pendingClarification: activeTask?.pendingClarification ?? null }
  await persistTurn({ workspaceId: input.workspaceId, userId: input.userId, conversationId: conversation.id, question: input.question, response, activeTask, previousTask, previousHistory, title: conversationTitle })
  console.info('Ask conversation completed', { conversationId: conversation.id, workspaceId: input.workspaceId, activeTaskType: activeTask?.type ?? null, followUpType: intentSource, clarificationResolved: intentSource === 'PENDING_CLARIFICATION', correctionDetected: intentSource === 'CORRECTION', resultReferenceResolved: intentSource === 'RESULT_REFERENCE', topicSwitchDetected: intentSource === 'TOPIC_SWITCH', intent: response.intent, intentSource, toolCalled, tavilyCalled: response.externalProvidersUsed.length > 0, resultCount: response.totalMatches, servingModel: null, latency: Date.now() - started })
  return response
}

export async function listConversations(workspaceId: string): Promise<ConversationListItem[]> {
  const rows = await db.conversation.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 50 })
  return rows.map((item) => ({ id: item.id, title: item.title, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), archivedAt: item.archivedAt?.toISOString() ?? null }))
}

export async function loadConversation(workspaceId: string, conversationId: string): Promise<{ conversation: ConversationListItem; messages: ConversationHistoryMessage[]; activeTask: ActiveTask | null }> {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, workspaceId, archivedAt: null } })
  if (!conversation) throw new ApiError(404, 'Conversation not found')
  const messages = await db.conversationMessage.findMany({ where: { workspaceId, conversationId }, orderBy: { createdAt: 'asc' }, take: 120 })
  return {
    conversation: { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString(), archivedAt: conversation.archivedAt?.toISOString() ?? null },
    messages: messages.map((message) => ({ id: message.id, role: message.role as 'USER' | 'ASSISTANT', text: message.text, messageType: message.messageType, intent: message.intent, structuredPayload: message.structuredPayload, createdAt: message.createdAt.toISOString() })),
    activeTask: parseTask(conversation.activeTask),
  }
}

export async function archiveConversation(workspaceId: string, conversationId: string) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, workspaceId } })
  if (!conversation) throw new ApiError(404, 'Conversation not found')
  if (!conversation.archivedAt) await db.conversation.update({ where: { id: conversation.id }, data: { archivedAt: new Date(), activeTask: Prisma.JsonNull, taskHistory: [] } })
  return { id: conversation.id, archived: true }
}
