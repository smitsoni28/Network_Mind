import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest } from '@/lib/api'
import { askSchema } from '@/lib/schemas'
import { archiveConversation, handleAskConversation, listConversations, loadConversation } from '@/lib/services/conversation-service'

function conversationIdFromUrl(request: Request): string | null {
  const url = new URL(request.url)
  return url.searchParams.get('conversationId')
}

export async function GET(request: Request) {
  try {
    const session = await secureRequest(request, 'ask:list', 60)
    const conversationId = conversationIdFromUrl(request)
    if (conversationId) return NextResponse.json(await loadConversation(session.workspaceId, conversationId))
    return NextResponse.json({ conversations: await listConversations(session.workspaceId) })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'ask', 15)
    const { question, conversationId, networkOnly, offset } = await parseJson(request, askSchema)
    return NextResponse.json(await handleAskConversation({ workspaceId: session.workspaceId, userId: session.userId, question, conversationId, networkOnly, offset }))
  } catch (error) { return errorResponse(error) }
}

export async function DELETE(request: Request) {
  try {
    const session = await secureRequest(request, 'ask:delete', 30)
    const conversationId = conversationIdFromUrl(request)
    if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    return NextResponse.json(await archiveConversation(session.workspaceId, conversationId))
  } catch (error) { return errorResponse(error) }
}
