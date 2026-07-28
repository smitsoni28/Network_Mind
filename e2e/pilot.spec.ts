import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { SignJWT } from 'jose'

const E2E_SESSION_SECRET = process.env.SESSION_SECRET ?? 'networkmind-e2e-session-secret-change-me-123456'
const E2E_BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100'

type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; archivedAt: string | null }
type HistoryMessage = { id: string; role: 'USER' | 'ASSISTANT'; text: string; messageType: string; intent: string | null; structuredPayload: unknown; createdAt: string }

async function seedSession(context: BrowserContext) {
  const token = await new SignJWT({ userId: 'e2e-user', workspaceId: 'e2e-workspace', email: 'pilot@example.com', displayName: 'Pilot Tester' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .setIssuer('networkmind')
    .setAudience('networkmind-pilot')
    .sign(new TextEncoder().encode(E2E_SESSION_SECRET))

  await context.addCookies([{ name: 'networkmind_session', value: token, url: E2E_BASE_URL, httpOnly: true, sameSite: 'Lax' }])
}

function response(conversation: Conversation, overrides: Record<string, unknown>) {
  return {
    mode: 'DIRECT',
    intent: 'DIRECT',
    answer: 'Done.',
    totalMatches: 0,
    displayedCount: 0,
    offset: 0,
    hasMore: false,
    recommendations: [],
    evidence: [],
    sources: [],
    topicSources: [],
    contactVerificationSources: [],
    uncertainty: [],
    searchedAt: null,
    externalProvidersUsed: [],
    analysisRunId: null,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    activeTask: null,
    pendingClarification: null,
    ...overrides,
  }
}

function recommendation(id: string, name: string, role: string, company: string, reasoning: string) {
  return {
    id: `rec-${id}`,
    analysisRunId: `run-${id}`,
    contact: { id: `contact-${id}`, fullName: name, company, role, location: 'Berlin, Germany', relationshipStrength: 'WARM', lastContactAt: '2025-04-01T00:00:00.000Z' },
    matchScore: 86,
    relationshipScore: 72,
    evidenceConfidence: 80,
    actionabilityScore: 76,
    priorityScore: 78,
    matchedFields: ['role', 'tags', 'notes'],
    reasoning,
    suggestedAction: 'Reach out with a focused note.',
    uncertainty: [],
    evidenceIds: [],
    exactMatch: false,
    inactiveDays: null,
  }
}

async function installMocks(page: Page) {
  const conversations: Conversation[] = []
  const messages = new Map<string, HistoryMessage[]>()
  let nextConversation = 1
  let nextMessage = 1
  let timestamp = Date.parse('2026-06-25T12:00:00.000Z')
  const counters = { tavily: 0, network: 0, exactLookup: 0 }

  const touch = (conversation: Conversation) => {
    timestamp += 1000
    conversation.updatedAt = new Date(timestamp).toISOString()
  }
  const ensureConversation = (id: string | undefined, title: string) => {
    if (id) {
      const existing = conversations.find((item) => item.id === id)
      if (existing) return existing
    }
    const now = new Date(timestamp).toISOString()
    const conversation = { id: `conv-${nextConversation++}`, title, createdAt: now, updatedAt: now, archivedAt: null }
    conversations.unshift(conversation)
    messages.set(conversation.id, [])
    return conversation
  }
  const pushTurn = (conversation: Conversation, question: string, payload: ReturnType<typeof response>) => {
    const createdAt = new Date(timestamp).toISOString()
    const rows = messages.get(conversation.id) ?? []
    rows.push({ id: `msg-${nextMessage++}`, role: 'USER', text: question, messageType: 'TEXT', intent: null, structuredPayload: null, createdAt })
    rows.push({ id: `msg-${nextMessage++}`, role: 'ASSISTANT', text: String(payload.answer), messageType: payload.mode === 'CLARIFICATION' ? 'CLARIFICATION' : payload.recommendations.length ? 'TOOL_RESULT' : 'TEXT', intent: String(payload.intent), structuredPayload: { response: payload }, createdAt })
    messages.set(conversation.id, rows)
    touch(conversation)
  }

  await page.route('**/api/auth/session', async (route) => route.fulfill({ json: { user: { email: 'pilot@example.com', displayName: 'Pilot Tester' } } }))
  await page.route('**/api/ask-network**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      const conversationId = url.searchParams.get('conversationId')
      if (conversationId) {
        const conversation = conversations.find((item) => item.id === conversationId && !item.archivedAt)
        await route.fulfill({ status: conversation ? 200 : 404, json: conversation ? { conversation, messages: messages.get(conversation.id) ?? [] } : { error: 'Conversation not found' } })
        return
      }
      await route.fulfill({ json: { conversations: conversations.filter((item) => !item.archivedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) } })
      return
    }

    const body = await request.postDataJSON() as { question: string; conversationId?: string; networkOnly?: boolean }
    const lower = body.question.toLowerCase()
    const title = lower.includes('sales') ? 'Sales contacts' : 'AI Germany research'
    const conversation = ensureConversation(body.conversationId, title)
    let payload: ReturnType<typeof response>

    if (lower === 'bro') {
      payload = response(conversation, { mode: 'DIRECT', intent: 'CASUAL_OR_META', answer: 'Got it. I will keep the last result in context.' })
    } else if (lower === 'why?' || lower === 'wtf') {
      payload = response(conversation, { mode: 'DIRECT', intent: lower === 'why?' ? 'EXPLAIN_PREVIOUS_RESULT' : 'CHALLENGE_PREVIOUS_RESULT', answer: 'I searched AI, startup, investment and Germany signals in the previous result without rerunning retrieval.' })
    } else if (lower.includes('sales')) {
      counters.network += 1
      payload = response(conversation, {
        mode: 'NETWORK',
        intent: 'NETWORK_SEARCH',
        answer: 'Found 1 sales contact. Searched sales, business development, account executive, revenue and GTM signals.',
        totalMatches: 1,
        displayedCount: 1,
        recommendations: [recommendation('sales', 'Riley Revenue', 'Account Executive', 'Revenue Co', 'role and tags match sales, revenue and GTM')],
        analysisRunId: 'run-sales',
      })
    } else if (body.networkOnly && lower === 'research ai startup investment activity in germany.') {
      payload = response(conversation, {
        mode: 'DIRECT',
        intent: 'BLOCKED_BY_MODE',
        answer: 'Public research is disabled in Network-only mode. I did not search the web or your contacts for "Research AI startup investment activity in Germany."',
        analysisRunId: 'run-public-blocked',
      })
    } else if (body.networkOnly) {
      counters.network += 1
      payload = response(conversation, {
        mode: 'NETWORK',
        intent: 'MIXED_RESEARCH',
        answer: 'Public research\nPublic research is disabled in Network-only mode.\n\nRelevant people in your network\nI searched imported contacts for AI, artificial intelligence, startup, venture capital, investor, investment, Germany, Berlin and Munich signals. Found 1 relevant contact.\n\nUncertainty\nThe public-research operation was not executed because Network-only mode is enabled.',
        totalMatches: 1,
        displayedCount: 1,
        recommendations: [recommendation('ai', 'Nora Wagner', 'Venture Capital Investor', 'Alpen VC', 'role and notes match AI startup investment in Germany')],
        analysisRunId: 'run-ai-network-only',
      })
    } else {
      counters.tavily += 1
      counters.network += 1
      payload = response(conversation, {
        mode: 'MIXED',
        intent: 'MIXED_RESEARCH',
        answer: 'Public research\nGerman AI startup investment activity is active across seed and growth rounds.\n\nRelevant people in your network\nFound 1 relevant contact.\n\nUncertainty\nPublic sources do not prove private relationships.',
        totalMatches: 1,
        displayedCount: 1,
        recommendations: [recommendation('ai', 'Nora Wagner', 'Venture Capital Investor', 'Alpen VC', 'role and notes match AI startup investment in Germany')],
        sources: [{ title: 'German AI investment report', url: 'https://example.org/ai-germany', snippet: 'AI funding activity in Germany.', source: 'example.org', retrievedAt: '2026-06-25T12:00:00.000Z' }],
        topicSources: [{ title: 'German AI investment report', url: 'https://example.org/ai-germany', snippet: 'AI funding activity in Germany.', source: 'example.org', retrievedAt: '2026-06-25T12:00:00.000Z' }],
        externalProvidersUsed: ['tavily'],
        analysisRunId: 'run-ai-mixed',
      })
    }

    pushTurn(conversation, body.question, payload)
    await route.fulfill({ json: payload })
  })

  return counters
}

async function ask(page: Page, question: string) {
  await page.getByRole('textbox', { name: 'Ask a question' }).fill(question)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('mixed, network-only, contextual reactions, sales search, and sidebar navigation', async ({ page, context }) => {
  await seedSession(context)
  const counters = await installMocks(page)
  const mixedQuestion = 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.'

  await page.goto('/ask')
  const history = page.getByRole('navigation', { name: 'Conversation history' })
  await expect(history).toBeVisible()

  await page.getByLabel('Network only').check()
  await ask(page, mixedQuestion)
  expect(counters.tavily).toBe(0)
  expect(counters.network).toBe(1)
  const networkOnlyAssistantMessage = page.getByTestId('assistant-message').last()
  await expect(networkOnlyAssistantMessage.getByText('Network', { exact: true })).toBeVisible()
  await expect(networkOnlyAssistantMessage.getByText(/Public research is disabled in Network-only mode/iu)).toBeVisible()
  await expect(networkOnlyAssistantMessage.getByText(/AI, artificial intelligence, startup, venture capital, investor, investment, Germany/iu)).toBeVisible()

  await ask(page, 'bro')
  expect(counters.tavily).toBe(0)
  expect(counters.network).toBe(1)
  await expect(page.getByTestId('assistant-message').last().getByText(/keep the last result in context/iu)).toBeVisible()

  await ask(page, 'Research AI startup investment activity in Germany.')
  expect(counters.tavily).toBe(0)
  expect(counters.network).toBe(1)
  const blockedPublicMessage = page.getByTestId('assistant-message').last()
  await expect(blockedPublicMessage.getByText('Direct', { exact: true })).toBeVisible()
  await expect(blockedPublicMessage.getByText(/did not search the web or your contacts/iu)).toBeVisible()

  await page.getByLabel('Network only').uncheck()
  await ask(page, mixedQuestion)
  expect(counters.tavily).toBe(1)
  expect(counters.network).toBe(2)
  const latestAssistantMessage = page.getByTestId('assistant-message').last()
  await expect(latestAssistantMessage.getByText('Mixed', { exact: true })).toBeVisible()
  await expect(latestAssistantMessage.getByText('Public research')).toBeVisible()
  await expect(latestAssistantMessage.getByText('Relevant people in your network')).toBeVisible()

  await ask(page, 'why?')
  expect(counters.network).toBe(2)
  await expect(page.getByTestId('assistant-message').last().getByText(/without rerunning retrieval/iu)).toBeVisible()

  await ask(page, 'wtf')
  expect(counters.network).toBe(2)
  await expect(page.getByTestId('assistant-message').last().getByText(/previous result without rerunning retrieval/iu)).toBeVisible()

  await history.getByRole('button', { name: 'New conversation' }).click()
  await ask(page, 'find me frnds in sales')
  expect(counters.exactLookup).toBe(0)
  const salesAssistantMessage = page.getByTestId('assistant-message').last()
  await expect(salesAssistantMessage.getByText('Network', { exact: true })).toBeVisible()
  await expect(salesAssistantMessage.getByText('Riley Revenue')).toBeVisible()
  await expect(salesAssistantMessage.getByText(/business development, account executive, revenue and GTM/iu)).toBeVisible()

  await history.getByRole('button', { name: 'AI Germany research', exact: true }).click()
  await expect(page.getByTestId('assistant-message').filter({ hasText: 'Nora Wagner' }).first()).toBeVisible()
  await history.getByRole('button', { name: 'Sales contacts', exact: true }).click()
  await expect(page.getByTestId('assistant-message').filter({ hasText: 'Riley Revenue' }).first()).toBeVisible()
})
