import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCsvText } from '@/lib/services/csv-import'

const dbMock = vi.hoisted(() => ({
  contact: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  importJob: {
    create: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: dbMock }))

describe('contact-service importContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.contact.findMany.mockResolvedValue([])
    dbMock.contact.create.mockResolvedValue({})
    dbMock.importJob.create.mockResolvedValue({ id: 'job-1' })
    dbMock.importJob.update.mockResolvedValue({})
    dbMock.auditLog.create.mockResolvedValue({})
  })

  it('returns imported, attempted, skipped, and skippedByReason counts', async () => {
    const { importContacts } = await import('@/lib/services/contact-service')
    const parsed = parseCsvText('Name,Email,Company\nA,a@example.com,X\nB,b@example.com,Y\nB Duplicate,b@example.com,Y')
    const result = await importContacts({ workspaceId: 'workspace-1', userId: 'user-1', filename: 'contacts.csv', mapping: parsed.mapping, includeWarnings: true, rows: parsed.rows })

    expect(result).toMatchObject({ imported: 2, attempted: 2, skipped: 1, total: 3, valid: 2, warning: 1, invalid: 0 })
    expect(result.skippedByReason.DUPLICATE_IN_FILE).toBe(1)
    expect(dbMock.contact.create).toHaveBeenCalledTimes(2)
    expect(dbMock.importJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'COMPLETED', attemptedRows: 2, importedRows: 2, skippedRows: 1 }),
    }))
  })

  it('counts P2002 conflicts as skipped duplicates instead of silently ignoring them', async () => {
    const { importContacts } = await import('@/lib/services/contact-service')
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: ['normalizedEmail'] } })
    dbMock.contact.create.mockRejectedValueOnce(conflict)
    const parsed = parseCsvText('Name,Email,Company\nA,a@example.com,X')
    const result = await importContacts({ workspaceId: 'workspace-1', userId: 'user-1', filename: 'contacts.csv', mapping: parsed.mapping, includeWarnings: true, rows: parsed.rows })

    expect(result).toMatchObject({ imported: 0, attempted: 1, skipped: 1, total: 1, valid: 1, warning: 0, invalid: 0 })
    expect(result.skippedByReason.DUPLICATE_CONTACT).toBe(1)
    expect(dbMock.importJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', importedRows: 0, skippedRows: 1 }),
    }))
  })
})
