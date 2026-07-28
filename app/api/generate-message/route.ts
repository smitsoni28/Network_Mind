import { NextResponse } from 'next/server'
import { ApiError, errorResponse, parseJson, secureRequest } from '@/lib/api'
import { generateMessageSchema } from '@/lib/schemas'
import { db } from '@/lib/db'
import { runStructuredLlm } from '@/lib/ai/run-llm'
import { GENERATE_MESSAGE_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import {
  buildOutreachProviderPayload,
  localOutreachDraft,
  outreachFactsUsed,
  serializeOutreachProviderPrompt,
} from '@/lib/services/outreach-draft'

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'generate-message', 10)
    const body = await parseJson(request, generateMessageSchema)
    const contact = await db.contact.findFirst({
      where: { id: body.contactId, workspaceId: session.workspaceId, archivedAt: null },
      select: { id: true, fullName: true, role: true, company: true },
    })
    if (!contact) throw new ApiError(404, 'Contact not found')
    const recommendation = body.recommendationId
      ? await db.recommendation.findFirst({ where: { id: body.recommendationId, contactId: contact.id, analysisRunId: body.analysisRunId, analysisRun: { workspaceId: session.workspaceId } }, select: { id: true, suggestedAction: true } })
      : await db.recommendation.findFirst({ where: { contactId: contact.id, analysisRunId: body.analysisRunId, analysisRun: { workspaceId: session.workspaceId } }, select: { id: true, suggestedAction: true } })
    if (!recommendation) throw new ApiError(404, 'Recommendation not found')
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: session.workspaceId },
      select: { dataProcessingConsentAt: true },
    })
    const requestedTopic = body.instruction?.trim() || recommendation.suggestedAction
    const providerPayload = buildOutreachProviderPayload({
      contact,
      channel: body.channel,
      tone: body.tone,
      instruction: body.instruction,
    })
    const factsUsed = outreachFactsUsed(providerPayload)
    let providerUsed = false
    let message = localOutreachDraft({ contact, tone: body.tone, requestedTopic })
    if (process.env.OPENROUTER_API_KEY && workspace.dataProcessingConsentAt) {
      const result = await runStructuredLlm<{ message: string }>({ system: GENERATE_MESSAGE_SYSTEM_PROMPT, user: serializeOutreachProviderPrompt(providerPayload), validate: (data) => {
        const value = data && typeof data === 'object' ? (data as { message?: unknown }).message : null
        return typeof value === 'string' && value.trim() && value.length <= 2000 ? { ok: true, data: { message: value.trim() } } : { ok: false, errors: ['message is required and must be under 2,000 characters'] }
      } })
      if (result.ok) {
        message = result.data.message
        providerUsed = true
      }
    }
    return NextResponse.json({ message, draft: true, channel: body.channel, factsUsed, providerUsed })
  } catch (error) { return errorResponse(error) }
}
