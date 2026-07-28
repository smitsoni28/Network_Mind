import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => {
  const tx = {
    conversationMessage: { create: vi.fn(async () => ({ id: 'message' })) },
    conversation: { update: vi.fn(async () => ({ id: 'conv1' })) },
  }
  const db = {
    conversation: {
      create: vi.fn(async () => ({ id: 'conv1', title: 'Marketing contacts', activeTask: null, taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: 'conv1' })),
    },
    conversationMessage: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  }
  const runAnalysis = vi.fn()
  return { db, tx, runAnalysis }
})

vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/services/analysis-service', () => ({ runAnalysis: mocks.runAnalysis }))

import { handleAskConversation, type ActiveTask } from '@/lib/services/conversation-service'

function networkTask(overrides: Partial<ActiveTask> = {}): ActiveTask {
  return {
    type: 'NETWORK_SEARCH',
    topic: 'marketing',
    originalQuery: 'Who in my network works in marketing?',
    scope: 'PRIVATE_NETWORK',
    filters: {},
    resultId: 'run1',
    orderedResultIds: ['c1', 'c2'],
    displayedResultIds: ['c1', 'c2'],
    displayedResults: [
      { contactId: 'c1', order: 1, name: 'Mara Market', role: 'Marketing Lead', company: 'Growth Co', matchedFields: ['role'], matchExplanation: 'role matches marketing', relationshipStrength: 'WARM', relevanceScore: 82, priorityScore: 75, lastContactAt: '2025-04-01T00:00:00.000Z', dateFields: { lastContactAt: true } },
      { contactId: 'c2', order: 2, name: 'Nico Brand', role: 'Brand Advisor', company: 'Brand Co', matchedFields: ['tags'], matchExplanation: 'tags match marketing', relationshipStrength: 'STRONG', relevanceScore: 76, priorityScore: 80, lastContactAt: '2024-08-01T00:00:00.000Z', dateFields: { lastContactAt: true } },
    ],
    noMatchDiagnostics: undefined,
    missingSlots: [],
    lastUpdatedAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  }
}

const analysisResponse = {
  mode: 'NETWORK',
  intent: 'NETWORK_SEARCH',
  answer: 'Found 2 relevant contacts.',
  totalMatches: 2,
  displayedCount: 2,
  offset: 0,
  hasMore: false,
  recommendations: [
    { id: 'r1', analysisRunId: 'run2', contact: { id: 'c1', fullName: 'Mara Market', role: 'Marketing Lead', company: 'Growth Co', location: null, relationshipStrength: 'WARM', lastContactAt: '2025-04-01T00:00:00.000Z' }, matchScore: 82, relationshipScore: 62, evidenceConfidence: 72, actionabilityScore: 75, priorityScore: 75, matchedFields: ['role'], reasoning: 'role matches marketing', suggestedAction: 'Reach out.', uncertainty: [], evidenceIds: [], exactMatch: false, inactiveDays: null },
  ],
  evidence: [],
  sources: [],
  topicSources: [],
  contactVerificationSources: [],
  uncertainty: [],
  searchedAt: null,
  externalProvidersUsed: [],
  analysisRunId: 'run2',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runAnalysis.mockResolvedValue(analysisResponse)
  mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Marketing contacts', activeTask: networkTask(), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
})

describe('conversation active-task state', () => {
  it('passes a mixed research request through without rewriting the original query', async () => {
    const query = 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.'
    await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: query, networkOnly: false })
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ query, networkOnly: false }))
  })

  it('passes Network-only mixed research through as mixed rather than pure network rewrite', async () => {
    const query = 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.'
    await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: query, networkOnly: true })
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ query, networkOnly: true }))
  })

  it('preserves informal explicit network-search wording instead of synthetic topic rewrites', async () => {
    const query = 'I am thinking about connecting to ppl in marketing'
    await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: query, networkOnly: true })
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ query, networkOnly: true }))
  })

  it('turns ambiguous one-year refinements into typed clarification without running web research', async () => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'i want to narrow it down to a year' })
    expect(response.mode).toBe('CLARIFICATION')
    expect(response.answer).toMatch(/not contacted for at least one year|interacted with during the last year/iu)
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
    const update = (mocks.tx.conversation.update.mock.calls as unknown as Array<[{ data: { activeTask: unknown } }]>).at(-1)?.[0].data.activeTask
    expect(JSON.stringify(update)).toContain('contactTimeFilter')
  })

  it('resolves latest one against pending clarification instead of treating latest as web research', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Marketing contacts', activeTask: networkTask({ pendingClarification: { slot: 'contactTimeFilter', question: 'Pick one', options: [{ id: 'inactive_one_year', label: 'Not contacted for at least one year', value: { inactivityDays: 365 } }, { id: 'contacted_last_year', label: 'Contacted during the last year', value: { lastContactFrom: '2025-06-25T00:00:00.000Z' } }] } }), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'the latest one' })
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ query: 'Who in my network works in marketing?', networkOnly: true }))
  })

  it('restores private-network context for corrections', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Web mistake', activeTask: { ...networkTask(), type: 'WEB_RESEARCH', scope: 'PUBLIC_WEB' }, taskHistory: [networkTask()], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'bro I meant contacts' })
    expect(response.mode).toBe('DIRECT')
    expect(response.answer).toMatch(/marketing contacts from your network|restored/iu)
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('answers result references from displayed metadata without a new lexical search', async () => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'which year are those?' })
    expect(response.intent).toBe('RESULT_REFERENCE')
    expect(response.answer).toContain('2024')
    expect(response.answer).toContain('2025')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('cancels pending state on nah without repeating the suggestion', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Marketing contacts', activeTask: networkTask({ pendingAction: { type: 'RERUN', parameters: { inactivityDays: 365 } } }), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'nah' })
    expect(response.answer).toBe('No problem. I cleared that pending step and kept the prior context.')
    const update = (mocks.tx.conversation.update.mock.calls as unknown as Array<[{ data: { activeTask: unknown } }]>).at(-1)?.[0].data.activeTask
    expect(JSON.stringify(update)).not.toContain('pendingAction')
  })

  it('explains a previous no-match result without rerunning retrieval', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'AI Germany contacts', activeTask: networkTask({ noMatchDiagnostics: { status: 'NO_MATCHES', searchedConcepts: ['ai', 'startup', 'investor', 'germany'], filters: { geography: 'Germany' }, totalContactsChecked: 290, contactsPassingDomainThreshold: 0, contactsExcludedByGeography: 2, contactsWithMissingRelevantFields: 12, reasonCode: 'FILTERS_TOO_NARROW' }, displayedResults: [], orderedResultIds: [], displayedResultIds: [] }), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'why?' })
    expect(response.intent).toBe('EXPLAIN_PREVIOUS_RESULT')
    expect(response.answer).toContain('I searched 290 contacts')
    expect(response.answer).toContain('ai, startup, investor, germany')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('explains Network-only public research blocks from persisted state', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Blocked research', activeTask: { ...networkTask(), type: 'WEB_RESEARCH', scope: 'PUBLIC_WEB', originalQuery: 'Research AI startup investment activity in Germany.', blockedOutcome: { status: 'BLOCKED_BY_MODE', reasonCode: 'NETWORK_ONLY_PUBLIC_RESEARCH', blockedTool: 'WEB_SEARCH', originalQuery: 'Research AI startup investment activity in Germany.', publicResearchTopic: 'Research AI startup investment activity in Germany.' }, displayedResults: [], orderedResultIds: [], displayedResultIds: [] }, taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'why?' })
    expect(response.intent).toBe('EXPLAIN_PREVIOUS_RESULT')
    expect(response.answer).toContain('Network-only mode was on')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('treats wtf after a result as a challenge, not a new network search', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'AI Germany contacts', activeTask: networkTask({ noMatchDiagnostics: { status: 'NO_MATCHES', searchedConcepts: ['ai', 'startup'], filters: {}, totalContactsChecked: 20, contactsPassingDomainThreshold: 0, contactsExcludedByGeography: 0, contactsWithMissingRelevantFields: 4, reasonCode: 'NO_DOMAIN_MATCH' }, displayedResults: [], orderedResultIds: [], displayedResultIds: [] }), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'wtf' })
    expect(response.intent).toBe('CHALLENGE_PREVIOUS_RESULT')
    expect(response.answer).toContain('right to question it')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it.each(['bro', 'cool', 'are you smart now?', 'y', 'yo yo wassup', 'lol', 'ok'])('treats casual turn "%s" as direct context, not a tool call', async (question) => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question })
    expect(response.intent).toBe('CASUAL_OR_META')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
    const update = (mocks.tx.conversation.update.mock.calls as unknown as Array<[{ data: { activeTask: ActiveTask } }]>).at(-1)?.[0].data.activeTask
    expect(update?.type).toBe('NETWORK_SEARCH')
    expect(JSON.stringify(response)).not.toContain('What would you like me to look for or explain?')
  })

  it('explains why displayed people matched using stored metadata', async () => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'why these people?' })
    expect(response.intent).toBe('EXPLAIN_PREVIOUS_RESULT')
    expect(response.answer).toContain('Mara Market matched role')
    expect(response.answer).toContain('Nico Brand matched tags')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('answers strongest-result follow-up from displayed metadata', async () => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'which one is strongest?' })
    expect(response.intent).toBe('RESULT_REFERENCE')
    expect(response.answer).toContain('Nico Brand')
    expect(response.answer).not.toMatch(/\b(?:priority|relevance)\s+\d+/iu)
    expect(response.answer).not.toMatch(/\b(?:76|80)\b/u)
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('paginates show more from the previous displayed result count', async () => {
    await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'show more' })
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ query: 'Who in my network works in marketing?', networkOnly: true, offset: 2 }))
  })

  it('refines displayed results without rerunning unrelated retrieval', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Marketing contacts', activeTask: networkTask({ displayedResultIds: ['c1', 'c2', 'c3'], orderedResultIds: ['c1', 'c2', 'c3'], displayedResults: [...networkTask().displayedResults!, { contactId: 'c3', order: 3, name: 'Casey Consultant', role: 'Strategy Consultant', company: 'Advisory Co', matchedFields: ['role'], matchExplanation: 'role matches consultant marketing', relationshipStrength: 'WARM', relevanceScore: 70, priorityScore: 65, lastContactAt: null, dateFields: { lastContactAt: false } }] }), taskHistory: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'not consultants' })
    expect(response.intent).toBe('TASK_REFINEMENT')
    expect(response.answer).toContain('Mara Market')
    expect(response.answer).not.toContain('Casey Consultant')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('drafts to the second displayed person from previous state', async () => {
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'draft a message to the second person' })
    expect(response.mode).toBe('DRAFT')
    expect(response.intent).toBe('MESSAGE_DRAFT')
    expect(response.answer).toContain('Draft for Nico Brand')
    expect(response.answer).not.toContain('c2')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })

  it('restores previous search context on an explicit go-back request', async () => {
    mocks.db.conversation.findFirst.mockResolvedValue({ id: 'conv1', title: 'Current', activeTask: networkTask({ topic: 'sales', originalQuery: 'Who in my network works in sales?' }), taskHistory: [networkTask({ topic: 'marketing', originalQuery: 'Who in my network works in marketing?' })], createdAt: new Date(), updatedAt: new Date(), archivedAt: null })
    const response = await handleAskConversation({ workspaceId: 'w', userId: 'u', conversationId: 'conv1', question: 'go back to the previous search' })
    expect(response.intent).toBe('RESULT_REFERENCE')
    expect(response.answer).toContain('marketing')
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
  })
})
