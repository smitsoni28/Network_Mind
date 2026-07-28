import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public details?: string[]) {
      super(message)
    }
  }
  const db = {
    contact: { findFirst: vi.fn() },
    recommendation: { findFirst: vi.fn() },
    workspace: { findUniqueOrThrow: vi.fn() },
  }
  const runStructuredLlm = vi.fn()
  const secureRequest = vi.fn(async () => ({ workspaceId: 'workspace-1', userId: 'user-1' }))
  return { ApiError, db, runStructuredLlm, secureRequest }
})

vi.mock('@/lib/api', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ApiError: mocks.ApiError,
    errorResponse: (error: unknown) => {
      if (error instanceof mocks.ApiError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
      return NextResponse.json({ error: 'The request could not be completed' }, { status: 500 })
    },
    parseJson: async (request: Request, schema: { parse: (value: unknown) => unknown }) => schema.parse(await request.json()),
    secureRequest: mocks.secureRequest,
  }
})
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/ai/run-llm', () => ({ runStructuredLlm: mocks.runStructuredLlm }))

import { POST } from '@/app/api/generate-message/route'
import { buildOutreachProviderPayload, serializeOutreachProviderPrompt } from '@/lib/services/outreach-draft'

const ids = {
  contact: '30000000-0000-4000-8000-000000000001',
  recommendation: '20000000-0000-4000-8000-000000000001',
  analysisRun: '10000000-0000-4000-8000-000000000001',
}

const contact = {
  id: ids.contact,
  fullName: 'Nora Secretson',
  role: 'Investor',
  company: 'Berlin Ventures',
  primaryEmail: 'nora.secretson@example.org',
  primaryPhone: '+1 202 555 0199',
  notes: 'private note about family situation',
  howMet: 'Confidential board dinner',
  relationshipStrength: 'STRONG',
  lastContactAt: new Date('2026-01-02T00:00:00.000Z'),
  source: 'IMPORT',
}

const recommendation = {
  id: ids.recommendation,
  suggestedAction: 'Ask about AI startup investment activity in Germany.',
  reasoning: 'Sensitive recommendation reasoning from private evidence.',
  evidenceIds: ['ev-sensitive'],
  priorityScore: 95,
}

function request(body: Record<string, unknown>) {
  return new Request('https://networkmind.example/api/generate-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactId: ids.contact,
      recommendationId: ids.recommendation,
      analysisRunId: ids.analysisRun,
      channel: 'LINKEDIN',
      tone: 'WARM',
      ...body,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.OPENROUTER_API_KEY
  mocks.db.contact.findFirst.mockResolvedValue(contact)
  mocks.db.recommendation.findFirst.mockResolvedValue(recommendation)
  mocks.db.workspace.findUniqueOrThrow.mockResolvedValue({ dataProcessingConsentAt: null })
  mocks.runStructuredLlm.mockResolvedValue({ ok: true, data: { message: 'Provider draft' } })
})

describe('generate-message route', () => {
  it('does not call the provider without workspace consent and still returns a local draft', async () => {
    process.env.OPENROUTER_API_KEY = 'configured'
    mocks.db.workspace.findUniqueOrThrow.mockResolvedValue({ dataProcessingConsentAt: null })

    const response = await POST(request({}))
    const data = await response.json() as { message: string; providerUsed: boolean }

    expect(mocks.runStructuredLlm).not.toHaveBeenCalled()
    expect(data.providerUsed).toBe(false)
    expect(data.message).toContain('Hi Nora')
    expect(data.message).toContain(recommendation.suggestedAction)
  })

  it('does not call the provider without an API key and still returns a local draft', async () => {
    mocks.db.workspace.findUniqueOrThrow.mockResolvedValue({ dataProcessingConsentAt: new Date('2026-07-01T00:00:00.000Z') })

    const response = await POST(request({ tone: 'CONCISE' }))
    const data = await response.json() as { message: string; providerUsed: boolean }

    expect(mocks.runStructuredLlm).not.toHaveBeenCalled()
    expect(data.providerUsed).toBe(false)
    expect(data.message).toBe(`Hi Nora,\n\n${recommendation.suggestedAction}\n\nBest,`)
  })

  it('sends only minimized draft data when provider configuration and consent are present', async () => {
    process.env.OPENROUTER_API_KEY = 'configured'
    mocks.db.workspace.findUniqueOrThrow.mockResolvedValue({ dataProcessingConsentAt: new Date('2026-07-01T00:00:00.000Z') })

    const response = await POST(request({ instruction: 'Ask about AI investment.' }))
    const data = await response.json() as { message: string; providerUsed: boolean }

    expect(data).toMatchObject({ message: 'Provider draft', providerUsed: true })
    expect(mocks.runStructuredLlm).toHaveBeenCalledTimes(1)
    const serializedCall = JSON.stringify(mocks.runStructuredLlm.mock.calls)
    expect(serializedCall).toContain('Nora')
    expect(serializedCall).toContain('Investor')
    expect(serializedCall).toContain('Berlin Ventures')
    expect(serializedCall).toContain('LINKEDIN')
    expect(serializedCall).toContain('WARM')
    expect(serializedCall).toContain('Ask about AI investment.')
    for (const forbidden of [
      'Secretson',
      'nora.secretson@example.org',
      '+1 202 555 0199',
      'private note',
      'Confidential board dinner',
      'STRONG',
      '2026-01-02',
      'IMPORT',
      'Sensitive recommendation reasoning',
      'ev-sensitive',
      '95',
    ]) {
      expect(serializedCall).not.toContain(forbidden)
    }
  })

  it('builds a helper payload that excludes extra contact and recommendation fields', () => {
    const payload = buildOutreachProviderPayload({
      contact,
      channel: 'EMAIL',
      tone: 'PROFESSIONAL',
      instruction: 'Invite her to compare notes.',
    })
    const serialized = serializeOutreachProviderPrompt(payload)

    expect(serialized).toContain('Nora')
    expect(serialized).toContain('Investor')
    expect(serialized).toContain('Berlin Ventures')
    expect(serialized).toContain('Invite her to compare notes.')
    expect(serialized).not.toContain('Secretson')
    expect(serialized).not.toContain('nora.secretson@example.org')
    expect(serialized).not.toContain('Confidential board dinner')
    expect(serialized).not.toContain('Sensitive recommendation reasoning')
  })
})
