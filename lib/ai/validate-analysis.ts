import type { Validated } from '@/lib/ai/run-llm'
import type { AiAnalysisRecommendation, AnalyzeNetworkResponse } from '@/lib/ai/types'

export type ValidationResult = Validated<AiAnalysisRecommendation[]>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  )
}

export function validateAnalysisResponse(
  data: unknown,
  allowedContactIds: Set<string>,
): ValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Response must be a JSON object'] }
  }

  const recommendations = (data as AnalyzeNetworkResponse).recommendations
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return { ok: false, errors: ['recommendations must be a non-empty array'] }
  }

  const validated: AiAnalysisRecommendation[] = []

  recommendations.forEach((item, index) => {
    const prefix = `recommendations[${index}]`
    let itemValid = true

    if (!item || typeof item !== 'object') {
      errors.push(`${prefix} must be an object`)
      return
    }

    const rec = item as Partial<AiAnalysisRecommendation>

    if (!isNonEmptyString(rec.contactId)) {
      errors.push(`${prefix}.contactId is required`)
      itemValid = false
    } else if (!allowedContactIds.has(rec.contactId)) {
      errors.push(`${prefix}.contactId "${rec.contactId}" is not a known contact`)
      itemValid = false
    }

    if (
      typeof rec.opportunityScore !== 'number' ||
      rec.opportunityScore < 0 ||
      rec.opportunityScore > 100
    ) {
      errors.push(`${prefix}.opportunityScore must be between 0 and 100`)
      itemValid = false
    }

    if (!isNonEmptyString(rec.reasoning)) {
      errors.push(`${prefix}.reasoning is required`)
      itemValid = false
    }

    if (!isStringArray(rec.evidence)) {
      errors.push(`${prefix}.evidence must be a non-empty string array`)
      itemValid = false
    }

    if (!isStringArray(rec.uncertainty)) {
      errors.push(`${prefix}.uncertainty must be a non-empty string array`)
      itemValid = false
    }

    if (!isNonEmptyString(rec.suggestedAction)) {
      errors.push(`${prefix}.suggestedAction is required`)
      itemValid = false
    }

    if (itemValid) {
      validated.push({
        contactId: rec.contactId!,
        opportunityScore: rec.opportunityScore!,
        reasoning: rec.reasoning!.trim(),
        evidence: rec.evidence!.map((e) => e.trim()),
        uncertainty: rec.uncertainty!.map((e) => e.trim()),
        suggestedAction: rec.suggestedAction!.trim(),
      })
    }
  })

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, data: validated }
}
