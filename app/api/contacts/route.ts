import { NextResponse } from 'next/server'
import { errorResponse, secureRequest } from '@/lib/api'
import { listContacts, workspaceStats } from '@/lib/services/contact-service'

export async function GET(request: Request) {
  try {
    const session = await secureRequest(request, 'contacts', 60)
    const [contacts, stats] = await Promise.all([listContacts(session.workspaceId), workspaceStats(session.workspaceId)])
    return NextResponse.json({ contacts, stats, sampleMode: contacts.length > 0 && contacts.every((contact) => contact.source === 'SAMPLE') })
  } catch (error) { return errorResponse(error) }
}
