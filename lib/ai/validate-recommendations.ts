import { z } from 'zod'

const recommendationSchema = z.object({
  contactId: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  reasoning: z.string().trim().min(1).max(2000), suggestedAction: z.string().trim().min(1).max(1000),
  uncertainty: z.array(z.string().trim().min(1)).min(1).max(10),
  matchScore: z.number().min(0).max(100), relationshipScore: z.number().min(0).max(100),
  evidenceConfidence: z.number().min(0).max(100), actionabilityScore: z.number().min(0).max(100), priorityScore: z.number().min(0).max(100),
}).strict()
const outputSchema = z.object({ recommendations: z.array(recommendationSchema).max(5) }).strict()

export function validateRecommendationReferences(data: unknown, allowedContactIds: Set<string>, allowedEvidenceIds: Set<string>) {
  const parsed = outputSchema.safeParse(data)
  if (!parsed.success) return { ok: false as const, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  const seen = new Set<string>(); const errors: string[] = []
  parsed.data.recommendations.forEach((item, index) => {
    if (!allowedContactIds.has(item.contactId)) errors.push(`recommendations[${index}].contactId is unknown`)
    if (seen.has(item.contactId)) errors.push(`recommendations[${index}] duplicates contactId ${item.contactId}`)
    seen.add(item.contactId)
    item.evidenceIds.forEach((id) => { if (!allowedEvidenceIds.has(id)) errors.push(`recommendations[${index}] contains unknown evidence ID ${id}`) })
  })
  return errors.length ? { ok: false as const, errors } : { ok: true as const, data: parsed.data }
}
