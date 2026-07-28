import type { RelationshipStrength } from '@prisma/client'

export function relationshipScore(strength: RelationshipStrength, lastContactAt: Date | null, now = new Date()): number {
  const base = { STRONG: 85, WARM: 62, COLD: 32, UNKNOWN: 20 }[strength]
  if (!lastContactAt) return base
  const days = Math.max(0, (now.getTime() - lastContactAt.getTime()) / 86_400_000)
  const recency = days <= 30 ? 10 : days <= 90 ? 6 : days <= 180 ? 2 : -5
  return Math.max(0, Math.min(100, base + recency))
}

/** Priority = 40% goal match + 20% relationship + 25% evidence + 15% actionability. */
export function scoreOpportunity(input: { match: number; relationship: number; evidence: number; actionability: number }) {
  const round = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
  const scores = { matchScore: round(input.match), relationshipScore: round(input.relationship), evidenceConfidence: round(input.evidence), actionabilityScore: round(input.actionability) }
  return { ...scores, priorityScore: round(scores.matchScore * 0.4 + scores.relationshipScore * 0.2 + scores.evidenceConfidence * 0.25 + scores.actionabilityScore * 0.15) }
}
