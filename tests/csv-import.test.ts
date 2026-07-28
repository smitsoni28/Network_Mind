import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isImportEligible, parseCsvText, summarizeCsvRows, validateCsvRows } from '@/lib/services/csv-import'

describe('CSV import', () => {
  it('parses standard CSV and quoted commas', () => {
    const parsed = parseCsvText('Name,Email,Notes\n"Jose Nair",jose@example.com,"Hello, world"')
    expect(parsed.rows[0].values.Notes).toBe('Hello, world')
    expect(validateCsvRows(parsed.rows, parsed.mapping)[0].status).toBe('valid')
  })

  it('detects semicolon delimiters', () => expect(parseCsvText('Name;Company\nTomas;Acme').delimiter).toBe(';'))

  it('preserves Unicode', () => expect(parseCsvText('Name\nGründer José').rows[0].values.Name).toBe('Gründer José'))

  it('returns structured warning codes and user-facing messages', () => {
    const parsed = parseCsvText('Name,Phone\nPriya Nair,+1 202 555 0100')
    const [row] = validateCsvRows(parsed.rows, parsed.mapping)
    expect(row.status).toBe('warning')
    expect(row.warningCodes).toContain('MISSING_EMAIL')
    expect(row.warnings.join(' ')).toContain('Email is missing')
    expect(row.issues[0]).toMatchObject({ code: 'MISSING_EMAIL', severity: 'warning' })
  })

  it('allows missing email as an eligible warning when another contact key exists', () => {
    const parsed = parseCsvText('Name,Phone\nPriya Nair,+1 202 555 0100')
    const [row] = validateCsvRows(parsed.rows, parsed.mapping)
    expect(row.status).toBe('warning')
    expect(isImportEligible(row, true)).toBe(true)
  })

  it('excludes warning rows when includeWarnings=false', () => {
    const parsed = parseCsvText('Name,Phone\nPriya Nair,+1 202 555 0100')
    const rows = validateCsvRows(parsed.rows, parsed.mapping)
    expect(isImportEligible(rows[0], false)).toBe(false)
    expect(summarizeCsvRows(rows, false).skippedByReason.WARNING_EXCLUDED).toBe(1)
  })

  it('marks invalid emails invalid and never import eligible', () => {
    const parsed = parseCsvText('Name,Email,Phone\nA,not-an-email,+1 202 555 0100')
    const [row] = validateCsvRows(parsed.rows, parsed.mapping)
    expect(row.status).toBe('invalid')
    expect(row.errorCodes).toContain('INVALID_EMAIL')
    expect(row.errors.join(' ')).toContain('Invalid email')
    expect(isImportEligible(row, true)).toBe(false)
  })

  it('marks missing names invalid with a structured code', () => {
    const parsed = parseCsvText('Name,Email\n,ada@example.com')
    const [row] = validateCsvRows(parsed.rows, parsed.mapping)
    expect(row.status).toBe('invalid')
    expect(row.errorCodes).toContain('MISSING_FULL_NAME')
  })

  it('detects duplicate rows with duplicate codes', () => {
    const parsed = parseCsvText('Name,Email,Company\nA,a@example.com,X\nB,a@example.com,Y')
    const rows = validateCsvRows(parsed.rows, parsed.mapping)
    expect(rows[1].warningCodes).toEqual(expect.arrayContaining(['DUPLICATE_IN_FILE', 'DUPLICATE_CONTACT']))
    expect(rows[1].warnings.join(' ')).toContain('Duplicate contact')
  })

  it('excludes duplicate rows even when includeWarnings=true', () => {
    const parsed = parseCsvText('Name,Email,Company\nA,a@example.com,X\nB,a@example.com,Y')
    const rows = validateCsvRows(parsed.rows, parsed.mapping)
    expect(isImportEligible(rows[1], true)).toBe(false)
    const summary = summarizeCsvRows(rows, true)
    expect(summary.attempted).toBe(1)
    expect(summary.skippedByReason.DUPLICATE_IN_FILE).toBe(1)
  })

  it('marks existing workspace duplicates with a specific code', () => {
    const parsed = parseCsvText('Name,Email,Company\nA,a@example.com,X')
    const rows = validateCsvRows(parsed.rows, parsed.mapping, new Set(['email:a@example.com']))
    expect(rows[0].warningCodes).toEqual(expect.arrayContaining(['DUPLICATE_EXISTING_CONTACT', 'DUPLICATE_CONTACT']))
    expect(isImportEligible(rows[0], true)).toBe(false)
    expect(summarizeCsvRows(rows, true).skippedByReason.DUPLICATE_EXISTING_CONTACT).toBe(1)
  })

  it('warns about invalid dates, clears the date, and remains eligible', () => {
    const parsed = parseCsvText('Name,Email,Last Contacted\nA,a@example.com,not-a-date')
    const [row] = validateCsvRows(parsed.rows, parsed.mapping)
    expect(row.status).toBe('warning')
    expect(row.warningCodes).toContain('INVALID_DATE')
    expect(row.contact?.lastContactAt).toBeNull()
    expect(isImportEligible(row, true)).toBe(true)
  })

  it('supports corrected mappings', () => {
    const parsed = parseCsvText('Person,Phone\nAda,+1 202 555 0100')
    expect(validateCsvRows(parsed.rows, { Person: 'fullName', Phone: 'phone' })[0].status).toBe('warning')
  })

  it('rejects more than 5000 rows', () => expect(() => parseCsvText(`Name\n${Array.from({ length: 5001 }, (_, i) => `A${i}`).join('\n')}`)).toThrow(/5,000/))

  it('keeps formula-like cells as text', () => expect(parseCsvText('Name,Notes\nAda,"=HYPERLINK(""bad"")"').rows[0].values.Notes.startsWith('=')).toBe(true))

  it('matches backend eligibility accounting for the 300-row fixture', () => {
    const parsed = parseCsvText(readFileSync('tests/fixtures/networkmind_test_contacts_300.csv', 'utf8'))
    const rows = validateCsvRows(parsed.rows, parsed.mapping)
    const summary = summarizeCsvRows(rows, true)
    expect(summary).toMatchObject({ total: 300, valid: 280, warning: 17, invalid: 3, attempted: 292, skipped: 5 })
    expect(summary.skippedByReason.DUPLICATE_IN_FILE).toBe(5)
  })
})
