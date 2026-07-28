import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest } from '@/lib/api'
import { confirmImportSchema } from '@/lib/schemas'
import { importContacts } from '@/lib/services/contact-service'

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'import-confirm', 5)
    const body = await parseJson(request, confirmImportSchema, 25 * 1024 * 1024)
    return NextResponse.json(await importContacts({ ...body, workspaceId: session.workspaceId, userId: session.userId }))
  } catch (error) { return errorResponse(error) }
}
