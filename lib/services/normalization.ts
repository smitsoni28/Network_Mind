export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

export function normalizeSearch(value: string): string {
  return normalizeText(value).toLocaleLowerCase('und')
}

export function normalizeEmail(value?: string | null): string | null {
  const normalized = value ? normalizeText(value).toLowerCase() : ''
  return normalized || null
}

export function normalizePhone(value?: string | null): string | null {
  if (!value) return null
  const leadingPlus = normalizeText(value).startsWith('+')
  const digits = value.replace(/\D/gu, '')
  return digits.length >= 7 ? `${leadingPlus ? '+' : ''}${digits}` : null
}

export function tokens(value: string): string[] {
  return normalizeSearch(value).match(/[\p{L}\p{N}]+/gu) ?? []
}
