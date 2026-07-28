import Papa from 'papaparse'
import { NextResponse } from 'next/server'
import { errorResponse, secureRequest } from '@/lib/api'
import { exportContacts } from '@/lib/services/contact-service'

export async function GET(request: Request) {
  try {
    const session = await secureRequest(request, 'export', 10)
    const contacts = await exportContacts(session.workspaceId)
    const format = new URL(request.url).searchParams.get('format')
    if (format === 'csv') {
      const csv = Papa.unparse(contacts.map((contact) => ({ ...contact, tags: contact.tags.join(';'), lastContactAt: contact.lastContactAt?.toISOString() ?? '', importedAt: contact.importedAt.toISOString() })), { escapeFormulae: true })
      return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="networkmind-contacts.csv"' } })
    }
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), contacts }, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="networkmind-contacts.json"' } })
  } catch (error) { return errorResponse(error) }
}
