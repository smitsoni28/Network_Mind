import { NextResponse } from 'next/server'
import { errorResponse, secureRequest } from '@/lib/api'
import { loadSampleNetwork } from '@/lib/services/contact-service'
export async function POST(request: Request) {
  try { const session = await secureRequest(request, 'sample', 5); return NextResponse.json(await loadSampleNetwork(session.workspaceId, session.userId)) }
  catch (error) { return errorResponse(error) }
}
