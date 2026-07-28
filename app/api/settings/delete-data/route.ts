import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest } from '@/lib/api'
import { deleteWorkspaceSchema } from '@/lib/schemas'
import { deleteWorkspaceData } from '@/lib/services/workspace-data-deletion'

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'delete-data', 3)
    await parseJson(request, deleteWorkspaceSchema)
    await deleteWorkspaceData({
      workspaceId: session.workspaceId,
      userId: session.userId,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) { return errorResponse(error) }
}
