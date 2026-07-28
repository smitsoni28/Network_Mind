import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest } from '@/lib/api'
import { analyzeSchema } from '@/lib/schemas'
import { runAnalysis } from '@/lib/services/analysis-service'

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'analyze', 10)
    const { goal, offset } = await parseJson(request, analyzeSchema)
    return NextResponse.json(await runAnalysis({ workspaceId: session.workspaceId, userId: session.userId, query: goal, offset }))
  } catch (error) { return errorResponse(error) }
}
