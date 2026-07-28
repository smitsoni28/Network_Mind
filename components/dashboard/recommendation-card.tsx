'use client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import type { PilotRecommendation } from '@/lib/client-types'
import { ArrowRight, MapPin } from 'lucide-react'

const label = (value: number) => value >= 80 ? 'High' : value >= 55 ? 'Medium' : 'Low'
export function RecommendationCard({ rec, index, onOpen }: { rec: PilotRecommendation; index: number; onOpen: () => void }) {
  const initials = rec.contact.fullName.split(/\s/u).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <Card className="group flex flex-col p-5 transition-shadow hover:shadow-md">
    <div className="flex items-start gap-3"><Avatar initials={initials} index={index} className="size-11 text-sm" /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{rec.contact.fullName}</p><p className="truncate text-sm text-muted-foreground">{rec.contact.role ?? 'Role not recorded'}{rec.contact.company ? ` · ${rec.contact.company}` : ''}</p>{rec.contact.location && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{rec.contact.location}</p>}</div><Badge tone="primary">Priority {rec.priorityScore}</Badge></div>
    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><Score label="Goal match" value={rec.matchScore} /><Score label="Relationship" value={rec.relationshipScore} /><Score label="Evidence" value={rec.evidenceConfidence} /></div>
    <div className="mt-4 rounded-lg bg-muted/60 p-3"><p className="text-xs font-semibold text-muted-foreground">Why this person matches</p><p className="mt-1 text-sm leading-relaxed">{rec.reasoning}</p></div>
    <button onClick={onOpen} className="mt-4 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium hover:bg-muted">Review evidence and draft outreach <ArrowRight className="size-4" /></button>
  </Card>
}
function Score({ label: name, value }: { label: string; value: number }) { return <div className="rounded-lg border p-2"><p className="font-semibold tabular-nums">{label(value)}</p><p className="mt-0.5 text-muted-foreground">{name}</p></div> }
