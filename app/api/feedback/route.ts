import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest, ApiError } from '@/lib/api'
import { feedbackSchema } from '@/lib/schemas'
import { db } from '@/lib/db'
export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'feedback', 30)
    const body = await parseJson(request, feedbackSchema)
    if (body.recommendationId) {
      const recommendation = await db.recommendation.findFirst({ where: { id: body.recommendationId, analysisRun: { workspaceId: session.workspaceId } } })
      if (!recommendation) throw new ApiError(404, 'Recommendation not found')
    }
    const feedback = await db.feedback.create({ data: { ...body, workspaceId: session.workspaceId } })
    return NextResponse.json({ id: feedback.id }, { status: 201 })
  } catch (error) { return errorResponse(error) }
}
