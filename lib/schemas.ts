import { z } from 'zod'

export const idSchema = z.string().uuid()
export const querySchema = z.string().trim().min(1).max(1000)
export const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(200) }).strict()
export const analyzeSchema = z.object({ goal: querySchema, offset: z.number().int().min(0).max(4995).optional().default(0) }).strict()
export const askSchema = z.object({ question: querySchema, conversationId: idSchema.optional(), networkOnly: z.boolean().optional().default(false), offset: z.number().int().min(0).max(4995).optional().default(0) }).strict()
export const generateMessageSchema = z.object({
  contactId: idSchema,
  recommendationId: idSchema.optional(),
  analysisRunId: idSchema.optional(),
  channel: z.enum(['EMAIL', 'LINKEDIN', 'SMS', 'OTHER']),
  tone: z.enum(['WARM', 'PROFESSIONAL', 'CONCISE']),
  instruction: z.string().trim().max(500).optional(),
}).refine((value) => value.recommendationId || value.analysisRunId, 'recommendationId or analysisRunId is required')
export const feedbackSchema = z.object({ recommendationId: idSchema.optional(), query: querySchema.optional(), useful: z.boolean(), comment: z.string().trim().max(1000).optional() }).strict()
export const settingsSchema = z.object({ webEnrichmentEnabled: z.boolean().optional(), consent: z.boolean().optional() }).strict()
export const deleteWorkspaceSchema = z.object({ confirmation: z.literal('DELETE MY NETWORK') }).strict()

export const csvFieldSchema = z.enum(['fullName', 'firstName', 'lastName', 'email', 'phone', 'company', 'role', 'location', 'notes', 'tags', 'lastContactAt', 'howMet', 'relationshipStrength', 'ignore'])
export const csvMappingSchema = z.record(z.string().max(200), csvFieldSchema)
export const importRowSchema = z.object({
  rowNumber: z.number().int().min(2).max(5002),
  values: z.record(z.string(), z.string().max(10_000)),
  status: z.enum(['valid', 'warning', 'invalid']).optional(),
  warnings: z.array(z.string().max(300)).max(20).optional(),
  warningCodes: z.array(z.string().max(80)).max(20).optional(),
  errors: z.array(z.string().max(300)).max(20).optional(),
  errorCodes: z.array(z.string().max(80)).max(20).optional(),
})
export const confirmImportSchema = z.object({ filename: z.string().trim().min(1).max(255), mapping: csvMappingSchema, includeWarnings: z.boolean(), rows: z.array(importRowSchema).max(5000) }).strict()
