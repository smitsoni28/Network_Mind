type DraftChannel = 'EMAIL' | 'LINKEDIN' | 'SMS' | 'OTHER'
type DraftTone = 'WARM' | 'PROFESSIONAL' | 'CONCISE'

export type OutreachDraftContact = {
  fullName: string
  role: string | null
  company: string | null
}

export type OutreachProviderPayload = {
  contact: {
    firstName: string
    role?: string
    company?: string
  }
  channel: DraftChannel
  tone: DraftTone
  instruction?: string
}

export function contactFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] || 'there'
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function buildOutreachProviderPayload({
  contact,
  channel,
  tone,
  instruction,
}: {
  contact: OutreachDraftContact
  channel: DraftChannel
  tone: DraftTone
  instruction?: string
}): OutreachProviderPayload {
  return {
    contact: {
      firstName: contactFirstName(contact.fullName),
      ...(optionalText(contact.role) ? { role: optionalText(contact.role) } : {}),
      ...(optionalText(contact.company) ? { company: optionalText(contact.company) } : {}),
    },
    channel,
    tone,
    ...(optionalText(instruction) ? { instruction: optionalText(instruction) } : {}),
  }
}

export function serializeOutreachProviderPrompt(payload: OutreachProviderPayload): string {
  return `<UNTRUSTED_DRAFT_INPUT>\n${JSON.stringify(payload)}\n</UNTRUSTED_DRAFT_INPUT>`
}

export function localOutreachDraft({
  contact,
  tone,
  requestedTopic,
}: {
  contact: OutreachDraftContact
  tone: DraftTone
  requestedTopic: string
}): string {
  const firstName = contactFirstName(contact.fullName)
  return tone === 'CONCISE'
    ? `Hi ${firstName},\n\n${requestedTopic}\n\nBest,`
    : `Hi ${firstName},\n\n${tone === 'WARM' ? "I hope you're well. " : ''}${requestedTopic}\n\nBest,`
}

export function outreachFactsUsed(payload: OutreachProviderPayload): string[] {
  return [
    `First name: ${payload.contact.firstName}`,
    payload.contact.role ? `Role: ${payload.contact.role}` : null,
    payload.contact.company ? `Company: ${payload.contact.company}` : null,
    `Channel: ${payload.channel}`,
    `Tone: ${payload.tone}`,
    payload.instruction ? 'User instruction provided' : null,
  ].filter((value): value is string => !!value)
}
