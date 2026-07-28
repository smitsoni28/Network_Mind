import { hash } from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { normalizeSearch } from '../lib/services/normalization'

const db = new PrismaClient()
async function main() {
  const email = process.env.PILOT_EMAIL?.trim().toLowerCase()
  const suppliedHash = process.env.PILOT_PASSWORD_HASH?.trim()
  const developmentPassword = process.env.NODE_ENV !== 'production' ? process.env.PILOT_PASSWORD : undefined
  if (!email || (!suppliedHash && !developmentPassword)) throw new Error('Set PILOT_EMAIL and PILOT_PASSWORD_HASH before seeding (or PILOT_PASSWORD for local development only).')
  const passwordHash = suppliedHash || await hash(developmentPassword!, 12)
  const workspace = await db.workspace.upsert({ where: { id: '00000000-0000-4000-8000-000000000001' }, update: {}, create: { id: '00000000-0000-4000-8000-000000000001', name: 'NetworkMind Pilot', webEnrichmentEnabled: process.env.WEB_ENRICHMENT_DEFAULT === 'true' } })
  await db.user.upsert({ where: { email }, update: { passwordHash }, create: { workspaceId: workspace.id, email, displayName: 'Pilot User', passwordHash } })
  const samples = [
    { fullName: 'Lena Hofmann', email: 'lena@example.test', company: 'Aurelius Capital', role: 'Partner, Early-Stage AI', location: 'Berlin, Germany', tags: ['investor','venture capital'], strength: 'WARM' as const },
    { fullName: 'Marco Bianchi', email: 'marco@example.test', company: 'Helix Manufacturing', role: 'VP of Operations', location: 'Munich, Germany', tags: ['manufacturing','industrial'], strength: 'COLD' as const },
    { fullName: 'Priya Nair', email: 'priya@example.test', company: 'Northwind Ventures', role: 'Principal', location: 'London, UK', tags: ['investor','AI startups'], strength: 'STRONG' as const },
    { fullName: 'Tomáš Rivera', email: 'tomas@example.test', company: 'Cascade Analytics', role: 'Co-Founder & CEO', location: 'Madrid, Spain', tags: ['founder','data'], strength: 'WARM' as const },
    { fullName: 'Sophie Laurent', email: 'sophie@example.test', company: 'Independent', role: 'Fractional CMO', location: 'Paris, France', tags: ['advisor','B2B SaaS'], strength: 'COLD' as const },
  ]
  for (const sample of samples) await db.contact.upsert({ where: { workspaceId_normalizedEmail: { workspaceId: workspace.id, normalizedEmail: sample.email } }, update: {}, create: { workspaceId: workspace.id, fullName: sample.fullName, normalizedName: normalizeSearch(sample.fullName), primaryEmail: sample.email, normalizedEmail: sample.email, company: sample.company, normalizedCompany: normalizeSearch(sample.company), role: sample.role, location: sample.location, tags: sample.tags, relationshipStrength: sample.strength, howMet: 'Fictional sample data', lastContactAt: sample.strength === 'COLD' ? new Date(Date.now() - 220 * 86_400_000) : new Date(Date.now() - 30 * 86_400_000), source: 'SAMPLE' } })
  console.info(`Seeded pilot user and ${samples.length} clearly labelled fictional sample contacts.`)
}
main().finally(() => db.$disconnect())
