import { NextResponse } from 'next/server'
import { errorResponse, parseJson, secureRequest } from '@/lib/api'
import { settingsSchema } from '@/lib/schemas'
import { db } from '@/lib/db'
import { webProviderStatus } from '@/lib/tools/web-search'

export async function GET(request: Request) {
  try {
    const session = await secureRequest(request, 'settings', 60)
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: session.workspaceId }, select: { name: true, webEnrichmentEnabled: true, dataProcessingConsentAt: true } })
    return NextResponse.json({ ...workspace, webSearch: webProviderStatus(workspace.webEnrichmentEnabled) })
  } catch (error) { return errorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const session = await secureRequest(request, 'settings-update', 20)
    const body = await parseJson(request, settingsSchema)
    const workspace = await db.workspace.update({ where: { id: session.workspaceId }, data: { webEnrichmentEnabled: body.webEnrichmentEnabled, dataProcessingConsentAt: body.consent === true ? new Date() : body.consent === false ? null : undefined } })
    await db.auditLog.create({ data: { workspaceId: session.workspaceId, userId: session.userId, action: 'PRIVACY_SETTINGS_UPDATED', metadata: { webEnrichmentEnabled: workspace.webEnrichmentEnabled, consent: !!workspace.dataProcessingConsentAt } } })
    return NextResponse.json({ webEnrichmentEnabled: workspace.webEnrichmentEnabled, dataProcessingConsentAt: workspace.dataProcessingConsentAt })
  } catch (error) { return errorResponse(error) }
}
