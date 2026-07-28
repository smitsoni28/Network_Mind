import Papa from 'papaparse'
import { z } from 'zod'
import type { RelationshipStrength } from '@prisma/client'
import { normalizeEmail, normalizePhone, normalizeSearch, normalizeText } from '@/lib/services/normalization'

export const MAX_CSV_BYTES = 10 * 1024 * 1024
export const MAX_CSV_ROWS = 5000
export const MAX_NOTE_LENGTH = 4000

export const CSV_WARNING_CODES = [
  'MISSING_EMAIL',
  'INVALID_DATE',
  'DUPLICATE_CONTACT',
  'DUPLICATE_IN_FILE',
  'DUPLICATE_EXISTING_CONTACT',
  'NO_USABLE_CONTACT_DATA',
  'MISSING_COMPANY',
  'MISSING_ROLE',
] as const
export const CSV_ERROR_CODES = ['INVALID_EMAIL', 'MISSING_FULL_NAME'] as const
export const IMPORT_SKIP_REASON_CODES = [
  'WARNING_EXCLUDED',
  'DUPLICATE_CONTACT',
  'DUPLICATE_IN_FILE',
  'DUPLICATE_EXISTING_CONTACT',
  'NO_USABLE_CONTACT_DATA',
] as const

export type CsvWarningCode = typeof CSV_WARNING_CODES[number]
export type CsvErrorCode = typeof CSV_ERROR_CODES[number]
export type CsvIssueCode = CsvWarningCode | CsvErrorCode
export type CsvIssueSeverity = 'warning' | 'error'
export type ImportSkipReasonCode = typeof IMPORT_SKIP_REASON_CODES[number]
export type CsvIssue = { code: CsvIssueCode; message: string; severity: CsvIssueSeverity }
export type CsvField = 'fullName' | 'firstName' | 'lastName' | 'email' | 'phone' | 'company' | 'role' | 'location' | 'notes' | 'tags' | 'lastContactAt' | 'howMet' | 'relationshipStrength' | 'ignore'
export type CsvMapping = Record<string, CsvField>
export type RawCsvRow = { rowNumber: number; values: Record<string, string> }
export type ValidatedCsvRow = RawCsvRow & {
  status: 'valid' | 'warning' | 'invalid'
  warnings: string[]
  warningCodes: CsvWarningCode[]
  errors: string[]
  errorCodes: CsvErrorCode[]
  issues: CsvIssue[]
  contact: NormalizedImportContact | null
}
export type CsvReviewRow = Omit<ValidatedCsvRow, 'contact'>
export type CsvImportSummary = {
  total: number
  valid: number
  warning: number
  invalid: number
  attempted: number
  skipped: number
  skippedByReason: Record<ImportSkipReasonCode, number>
}
export type NormalizedImportContact = {
  fullName: string; normalizedName: string; primaryEmail: string | null; normalizedEmail: string | null;
  primaryPhone: string | null; normalizedPhone: string | null; company: string | null; normalizedCompany: string | null;
  role: string | null; location: string | null; notes: string | null; tags: string[]; lastContactAt: Date | null;
  howMet: string | null; relationshipStrength: RelationshipStrength;
}
export type ContactImportKeys = {
  normalizedEmail: string | null
  normalizedPhone: string | null
  normalizedName: string
  normalizedCompany: string | null
}

export const IMPORT_SKIP_REASON_LABELS: Record<ImportSkipReasonCode, string> = {
  WARNING_EXCLUDED: 'Warning rows excluded',
  DUPLICATE_CONTACT: 'Duplicate contact',
  DUPLICATE_IN_FILE: 'Duplicate in file',
  DUPLICATE_EXISTING_CONTACT: 'Already in workspace',
  NO_USABLE_CONTACT_DATA: 'No usable contact key',
}

const aliases: Record<Exclude<CsvField, 'ignore'>, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'contact name'], firstName: ['first name', 'firstname', 'given name'], lastName: ['last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'email address', 'e-mail'], phone: ['phone', 'phone number', 'mobile', 'telephone'], company: ['company', 'organization', 'organisation', 'employer'],
  role: ['title', 'job title', 'role', 'position'], location: ['location', 'city', 'country', 'city country'], notes: ['notes', 'note', 'comments'], tags: ['tags', 'tag', 'labels'],
  lastContactAt: ['last contacted', 'last contact', 'last contacted at', 'lastcontacted'], howMet: ['how we met', 'how met', 'how i met'], relationshipStrength: ['relationship strength', 'strength', 'relationship'],
}

function warning(code: CsvWarningCode, message: string): CsvIssue {
  return { code, message, severity: 'warning' }
}

function errorIssue(code: CsvErrorCode, message: string): CsvIssue {
  return { code, message, severity: 'error' }
}

function emptySkippedByReason(): Record<ImportSkipReasonCode, number> {
  return Object.fromEntries(IMPORT_SKIP_REASON_CODES.map((code) => [code, 0])) as Record<ImportSkipReasonCode, number>
}

export function autoMapHeaders(headers: string[]): CsvMapping {
  return Object.fromEntries(headers.map((header) => {
    const normalized = normalizeSearch(header).replace(/[_-]+/gu, ' ')
    const field = (Object.entries(aliases) as Array<[Exclude<CsvField, 'ignore'>, string[]]>).find(([, variants]) => variants.includes(normalized))?.[0] ?? 'ignore'
    return [header, field]
  }))
}

function safeCell(value: unknown): string {
  return normalizeText(typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, 10_000)
}

export function parseCsvText(text: string): { headers: string[]; delimiter: string; rows: RawCsvRow[]; mapping: CsvMapping; warnings: string[] } {
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) throw new Error('CSV file exceeds the 10 MB limit')
  const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/u, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (value) => normalizeText(value), dynamicTyping: false })
  const headers = (parsed.meta.fields ?? []).filter(Boolean)
  if (!headers.length) throw new Error('CSV must contain a header row')
  if (parsed.data.length > MAX_CSV_ROWS) throw new Error(`CSV exceeds the ${MAX_CSV_ROWS.toLocaleString()} row limit`)
  const rows = parsed.data.map((values, index) => ({ rowNumber: index + 2, values: Object.fromEntries(headers.map((header) => [header, safeCell(values[header])])) }))
  const warnings = parsed.errors.slice(0, 20).map((csvError) => `Row ${(csvError.row ?? 0) + 2}: ${csvError.message}`)
  return { headers, delimiter: parsed.meta.delimiter || ',', rows, mapping: autoMapHeaders(headers), warnings }
}

function mapped(row: RawCsvRow, mapping: CsvMapping, field: CsvField): string {
  return normalizeText(Object.entries(mapping).filter(([, target]) => target === field).map(([header]) => row.values[header] ?? '').filter(Boolean).join(' '))
}

function dateValue(value: string): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u.exec(value)
  if (!match) return null
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (result.getUTCFullYear() !== year || result.getUTCMonth() + 1 !== month || result.getUTCDate() !== day) return null
  return result
}

function strength(value: string): RelationshipStrength {
  const normalized = normalizeSearch(value)
  if (normalized === 'strong') return 'STRONG'
  if (normalized === 'warm') return 'WARM'
  if (normalized === 'cold') return 'COLD'
  return 'UNKNOWN'
}

export function importKeysForContact(contact: ContactImportKeys): string[] {
  return [
    contact.normalizedEmail ? `email:${contact.normalizedEmail}` : '',
    contact.normalizedPhone ? `phone:${contact.normalizedPhone}` : '',
    contact.normalizedCompany ? `name:${contact.normalizedName}|${contact.normalizedCompany}` : '',
  ].filter(Boolean)
}

export function hasUsableNormalizedContactData(contact: NormalizedImportContact | null): boolean {
  return !!contact && importKeysForContact(contact).length > 0
}

export function validateCsvRows(rows: RawCsvRow[], mapping: CsvMapping, existingKeys: Set<string> = new Set()): ValidatedCsvRow[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const issues: CsvIssue[] = []
    const fullName = mapped(row, mapping, 'fullName') || normalizeText(`${mapped(row, mapping, 'firstName')} ${mapped(row, mapping, 'lastName')}`)
    const emailRaw = mapped(row, mapping, 'email')
    const phoneRaw = mapped(row, mapping, 'phone')
    const company = mapped(row, mapping, 'company') || null
    const role = mapped(row, mapping, 'role') || null
    const lastContactRaw = mapped(row, mapping, 'lastContactAt')
    const email = normalizeEmail(emailRaw)
    const validEmail = email ? z.string().email().safeParse(email).success : true
    const normalizedName = normalizeSearch(fullName)
    const normalizedCompany = company ? normalizeSearch(company) : null
    const phone = normalizePhone(phoneRaw)
    const keys = [email && validEmail ? `email:${email}` : '', phone ? `phone:${phone}` : '', normalizedName && normalizedCompany ? `name:${normalizedName}|${normalizedCompany}` : ''].filter(Boolean)

    if (!fullName) issues.push(errorIssue('MISSING_FULL_NAME', 'Full name is required'))
    if (email && !validEmail) issues.push(errorIssue('INVALID_EMAIL', `Invalid email: ${emailRaw}`))
    if (!emailRaw) issues.push(warning('MISSING_EMAIL', 'Email is missing; the contact can still be imported when another contact key is present'))
    if (Object.values(mapping).includes('company') && !company) issues.push(warning('MISSING_COMPANY', 'Company is missing'))
    if (Object.values(mapping).includes('role') && !role) issues.push(warning('MISSING_ROLE', 'Role or title is missing'))
    if (lastContactRaw && !dateValue(lastContactRaw)) issues.push(warning('INVALID_DATE', `Invalid date: ${lastContactRaw}; last-contact date will be omitted`))
    if (keys.length === 0) issues.push(warning('NO_USABLE_CONTACT_DATA', 'No usable email, phone, or name plus company key is available'))

    const duplicatesInFile = keys.some((key) => seen.has(key))
    const duplicatesExisting = keys.some((key) => existingKeys.has(key))
    if (duplicatesInFile) issues.push(warning('DUPLICATE_IN_FILE', 'Duplicate contact detected in this file'))
    if (duplicatesExisting) issues.push(warning('DUPLICATE_EXISTING_CONTACT', 'Duplicate contact already exists in this workspace'))
    if (duplicatesInFile || duplicatesExisting) issues.push(warning('DUPLICATE_CONTACT', 'Duplicate contact detected'))
    keys.forEach((key) => seen.add(key))

    const errorCodes = issues.filter((issue): issue is CsvIssue & { code: CsvErrorCode } => issue.severity === 'error').map((issue) => issue.code)
    const warningCodes = issues.filter((issue): issue is CsvIssue & { code: CsvWarningCode } => issue.severity === 'warning').map((issue) => issue.code)
    const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message)
    const warnings = issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)
    const invalid = errorCodes.length > 0
    const contact: NormalizedImportContact | null = invalid ? null : {
      fullName, normalizedName, primaryEmail: email, normalizedEmail: email, primaryPhone: phoneRaw || null, normalizedPhone: phone,
      company, normalizedCompany, role, location: mapped(row, mapping, 'location') || null,
      notes: (mapped(row, mapping, 'notes') || null)?.slice(0, MAX_NOTE_LENGTH) ?? null,
      tags: mapped(row, mapping, 'tags').split(/[,;|]/u).map(normalizeText).filter(Boolean).slice(0, 30),
      lastContactAt: dateValue(lastContactRaw), howMet: mapped(row, mapping, 'howMet') || null, relationshipStrength: strength(mapped(row, mapping, 'relationshipStrength')),
    }
    return { ...row, status: invalid ? 'invalid' : warningCodes.length ? 'warning' : 'valid', warnings, warningCodes, errors, errorCodes, issues, contact }
  })
}

export function primaryImportSkipReason(row: ValidatedCsvRow, includeWarnings: boolean): ImportSkipReasonCode | null {
  if (row.status === 'invalid') return null
  if (row.warningCodes.includes('DUPLICATE_IN_FILE')) return 'DUPLICATE_IN_FILE'
  if (row.warningCodes.includes('DUPLICATE_EXISTING_CONTACT')) return 'DUPLICATE_EXISTING_CONTACT'
  if (row.warningCodes.includes('DUPLICATE_CONTACT')) return 'DUPLICATE_CONTACT'
  if (!hasUsableNormalizedContactData(row.contact)) return 'NO_USABLE_CONTACT_DATA'
  if (row.status === 'warning' && !includeWarnings) return 'WARNING_EXCLUDED'
  return null
}

export function isImportEligible(row: ValidatedCsvRow, includeWarnings: boolean): boolean {
  return row.status !== 'invalid' && primaryImportSkipReason(row, includeWarnings) === null
}

export function summarizeCsvRows(rows: ValidatedCsvRow[], includeWarnings: boolean): CsvImportSummary {
  const skippedByReason = emptySkippedByReason()
  let attempted = 0
  let skipped = 0
  for (const row of rows) {
    const reason = primaryImportSkipReason(row, includeWarnings)
    if (reason) {
      skipped += 1
      skippedByReason[reason] += 1
    } else if (row.status !== 'invalid') {
      attempted += 1
    }
  }
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === 'valid').length,
    warning: rows.filter((row) => row.status === 'warning').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    attempted,
    skipped,
    skippedByReason,
  }
}

export function mergeSkippedByReason(left: Record<ImportSkipReasonCode, number>, right: Partial<Record<ImportSkipReasonCode, number>>): Record<ImportSkipReasonCode, number> {
  const merged = emptySkippedByReason()
  for (const code of IMPORT_SKIP_REASON_CODES) merged[code] = (left[code] ?? 0) + (right[code] ?? 0)
  return merged
}

export function toReviewRow(row: ValidatedCsvRow): CsvReviewRow {
  return {
    rowNumber: row.rowNumber,
    values: row.values,
    status: row.status,
    warnings: row.warnings,
    warningCodes: row.warningCodes,
    errors: row.errors,
    errorCodes: row.errorCodes,
    issues: row.issues,
  }
}
