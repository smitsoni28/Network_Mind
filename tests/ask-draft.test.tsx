// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecommendationResultCard } from '@/app/ask/page'
import type { PilotRecommendation } from '@/lib/client-types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Ask recommendation draft control', () => {
  it('posts canonical selected-contact IDs and editable draft settings', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, request?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ message: string }> }>>()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: 'Hi Nora, could we discuss German AI investment?' }) })
    vi.stubGlobal('fetch', fetchMock)
    const recommendation: PilotRecommendation = {
      id: '20000000-0000-4000-8000-000000000001', analysisRunId: '10000000-0000-4000-8000-000000000001',
      contact: { id: '30000000-0000-4000-8000-000000000001', fullName: 'Nora Wagner', role: 'Investor', company: 'Berlin Ventures', location: 'Berlin, Germany', relationshipStrength: 'WARM', lastContactAt: null },
      matchScore: 92, relationshipScore: 68, evidenceConfidence: 72, actionabilityScore: 75, priorityScore: 80,
      matchedFields: ['role', 'location'], reasoning: 'Role matches investor', suggestedAction: 'Ask about investment activity.', uncertainty: ['Unknown'], evidenceIds: [],
    }
    render(<RecommendationResultCard rec={recommendation} evidence={[]} analysisRunId={recommendation.analysisRunId!} />)
    expect(screen.queryByText('Match 92')).toBeNull()
    expect(screen.queryByText('Relationship 68')).toBeNull()
    expect(screen.queryByText('Priority 80')).toBeNull()
    expect(screen.queryByText('Strong match')).not.toBeNull()
    expect(screen.queryByText('Warm relationship')).not.toBeNull()
    expect(screen.queryByText('High priority')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Draft message' }))
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'LINKEDIN' } })
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'CONCISE' } })
    fireEvent.change(screen.getByLabelText('Optional instruction'), { target: { value: 'Ask about AI startup investment activity in Germany.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, request] = fetchMock.mock.calls[0]
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      contactId: recommendation.contact.id, recommendationId: recommendation.id, analysisRunId: recommendation.analysisRunId,
      channel: 'LINKEDIN', tone: 'CONCISE', instruction: 'Ask about AI startup investment activity in Germany.',
    })
    expect((await screen.findByLabelText('Draft for Nora Wagner') as HTMLTextAreaElement).value).toBe('Hi Nora, could we discuss German AI investment?')
  })
})
