import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { normalizeSearch } from '@/lib/services/normalization'
import { importKeysForContact, isImportEligible, mergeSkippedByReason, summarizeCsvRows, toReviewRow, validateCsvRows, type CsvMapping, type ImportSkipReasonCode, type RawCsvRow } from '@/lib/services/csv-import'

export async function listContacts(workspaceId: string) {
  return db.contact.findMany({ where: { workspaceId, archivedAt: null }, include: { interactions: { orderBy: { occurredAt: 'desc' }, take: 10 }, outgoingEdges: true }, orderBy: { fullName: 'asc' } })
}

export async function workspaceStats(workspaceId: string) {
  const [contacts, cold, recommendations] = await Promise.all([
    db.contact.count({ where: { workspaceId, archivedAt: null } }),
    db.contact.count({ where: { workspaceId, archivedAt: null, OR: [{ lastContactAt: { lt: new Date(Date.now() - 120 * 86_400_000) } }, { relationshipStrength: 'COLD' }] } }),
    db.recommendation.count({ where: { analysisRun: { workspaceId } } }),
  ])
  return { contacts, cold, recommendations }
}

export async function loadContactImportKeys(workspaceId: string) {
  const existing = await db.contact.findMany({ where: { workspaceId }, select: { normalizedEmail: true, normalizedPhone: true, normalizedName: true, normalizedCompany: true } })
  return new Set(existing.flatMap(importKeysForContact))
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function issueSummary(validated: ReturnType<typeof validateCsvRows>) {
  return validated.filter((row) => row.issues.length).map((row) => ({
    row: row.rowNumber,
    issues: row.issues.map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message })),
  })).slice(0, 500)
}

export async function importContacts(input: { workspaceId: string; userId: string; filename: string; mapping: CsvMapping; includeWarnings: boolean; rows: RawCsvRow[] }) {
  const existingKeys = await loadContactImportKeys(input.workspaceId)
  const validated = validateCsvRows(input.rows, input.mapping, existingKeys)
  const summary = summarizeCsvRows(validated, input.includeWarnings)
  const selected = validated.filter((row) => isImportEligible(row, input.includeWarnings))
  const job = await db.importJob.create({ data: {
    workspaceId: input.workspaceId, filename: input.filename, status: 'PENDING', totalRows: summary.total,
    validRows: summary.valid, warningRows: summary.warning, invalidRows: summary.invalid, mapping: input.mapping,
    attemptedRows: summary.attempted, importedRows: 0, skippedRows: summary.skipped, skippedSummary: summary.skippedByReason,
    errorSummary: issueSummary(validated),
  } })

  let imported = 0
  let conflictSkipped = 0
  let skippedByReason: Record<ImportSkipReasonCode, number>
  try {
    for (const row of selected) {
      try {
        await db.contact.create({ data: { ...row.contact!, workspaceId: input.workspaceId, source: `CSV:${job.id}` } })
        imported += 1
      } catch (error) {
        if (!isUniqueConflict(error)) throw error
        conflictSkipped += 1
      }
    }
    skippedByReason = mergeSkippedByReason(summary.skippedByReason, { DUPLICATE_CONTACT: conflictSkipped } satisfies Partial<Record<ImportSkipReasonCode, number>>)
    const skipped = summary.skipped + conflictSkipped
    const result = {
      importJobId: job.id,
      imported,
      attempted: summary.attempted,
      skipped,
      total: summary.total,
      valid: summary.valid,
      warning: summary.warning,
      invalid: summary.invalid,
      skippedByReason,
      counts: { total: summary.total, valid: summary.valid, warning: summary.warning, invalid: summary.invalid },
      rows: validated.map(toReviewRow),
    }
    await db.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), attemptedRows: result.attempted, importedRows: result.imported, skippedRows: result.skipped, skippedSummary: result.skippedByReason } })
    await db.auditLog.create({ data: { workspaceId: input.workspaceId, userId: input.userId, action: 'CONTACTS_IMPORTED', metadata: { importJobId: job.id, filename: input.filename, imported: result.imported, attempted: result.attempted, skipped: result.skipped, skippedByReason: result.skippedByReason } } })
    return result
  } catch (error) {
    skippedByReason = mergeSkippedByReason(summary.skippedByReason, { DUPLICATE_CONTACT: conflictSkipped } satisfies Partial<Record<ImportSkipReasonCode, number>>)
    await db.importJob.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), attemptedRows: summary.attempted, importedRows: imported, skippedRows: summary.skipped + conflictSkipped, skippedSummary: skippedByReason, errorSummary: { issues: issueSummary(validated), failure: error instanceof Error ? error.message : 'Import failed' } } }).catch((updateError: unknown) => {
      console.error('Failed to mark import job as failed', updateError instanceof Error ? updateError.message : updateError)
    })
    throw error
  }
}

export async function exportContacts(workspaceId: string) {
  return db.contact.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, fullName: true, primaryEmail: true, primaryPhone: true, company: true, role: true, location: true, tags: true, notes: true, relationshipStrength: true, lastContactAt: true, howMet: true, source: true, importedAt: true }, orderBy: { fullName: 'asc' } })
}

export async function loadSampleNetwork(workspaceId: string, userId: string) {
  const sample = [
    ['Lena Hofmann','lena@example.test','Aurelius Capital','Partner, Early-Stage AI','Berlin, Germany',['investor','venture capital'],'WARM'],
    ['Marco Bianchi','marco@example.test','Helix Manufacturing','VP of Operations','Munich, Germany',['manufacturing','industrial'],'COLD'],
    ['Priya Nair','priya@example.test','Northwind Ventures','Principal','London, UK',['investor','AI startups'],'STRONG'],
    ['Tomáš Rivera','tomas@example.test','Cascade Analytics','Co-Founder & CEO','Madrid, Spain',['founder','data'],'WARM'],
    ['Sophie Laurent','sophie@example.test','Independent','Fractional CMO','Paris, France',['advisor','B2B SaaS'],'COLD'],
  ] as const
  await db.$transaction(async (tx) => {
    for (const [fullName, email, company, role, location, tags, relationshipStrength] of sample) {
      await tx.contact.upsert({ where: { workspaceId_normalizedEmail: { workspaceId, normalizedEmail: email } }, update: {}, create: { workspaceId, fullName, normalizedName: normalizeSearch(fullName), primaryEmail: email, normalizedEmail: email, company, normalizedCompany: normalizeSearch(company), role, location, tags: [...tags], relationshipStrength, lastContactAt: relationshipStrength === 'COLD' ? new Date(Date.now() - 220 * 86_400_000) : new Date(Date.now() - 30 * 86_400_000), howMet: 'Fictional sample data', source: 'SAMPLE' } })
    }
    await tx.auditLog.create({ data: { workspaceId, userId, action: 'SAMPLE_NETWORK_LOADED', metadata: { fictional: true } } })
  })
  return { loaded: sample.length }
}
