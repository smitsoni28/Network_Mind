import { createHash, randomUUID } from 'node:crypto'

export type EvidenceItem = {
  id: string
  type: 'NETWORK' | 'INTERACTION' | 'EDGE' | 'WEB'
  source: string
  contactId: string | null
  title: string | null
  detail: string
  url: string | null
  retrievedAt: string | null
  occurredAt: string | null
  confidence: number
}

export function evidenceId(item: Omit<EvidenceItem, 'id'>): string {
  return `ev_${createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 24)}`
}

export function makeEvidence(item: Omit<EvidenceItem, 'id'>): EvidenceItem {
  const bounded = { ...item, detail: item.detail.normalize('NFKC').slice(0, 1500), confidence: Math.max(0, Math.min(100, Math.round(item.confidence))) }
  return { id: `ev_${randomUUID()}`, ...bounded }
}

export function serializeUntrustedEvidence(query: string, evidence: EvidenceItem[], contacts: Array<{ id: string; fullName: string; company: string | null; role: string | null; location: string | null }>) {
  return `<UNTRUSTED_EVIDENCE_BUNDLE>\n${JSON.stringify({ query, contacts, evidence }, null, 2)}\n</UNTRUSTED_EVIDENCE_BUNDLE>`
}
