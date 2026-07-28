'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { EvidenceView, PilotRecommendation } from '@/lib/client-types'

export function ContactDrawer({ rec, evidence, analysisRunId, onClose }: { rec: PilotRecommendation | null; evidence: EvidenceView[]; analysisRunId: string | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null); const closeButton = useRef<HTMLButtonElement>(null); const priorFocus = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState(''); const [providerUsed, setProviderUsed] = useState<boolean | null>(null); const [loading, setLoading] = useState(false); const [feedback, setFeedback] = useState<string | null>(null)
  useEffect(() => {
    if (!rec) return
    priorFocus.current = document.activeElement as HTMLElement; closeButton.current?.focus(); document.body.style.overflow = 'hidden'
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && panel.current) { const focusable = [...panel.current.querySelectorAll<HTMLElement>('button,a[href],textarea,input,select,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled')); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = ''; priorFocus.current?.focus() }
  }, [rec, onClose])
  if (!rec) return null
  const current = rec
  const supporting = evidence.filter((item) => current.evidenceIds.includes(item.id))
  async function generate() { setLoading(true); setProviderUsed(null); try { const response = await fetch('/api/generate-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: current.contact.id, recommendationId: current.id, analysisRunId, channel: 'EMAIL', tone: 'WARM' }) }); const data = await response.json() as { message?: string; error?: string; providerUsed?: boolean }; if (!response.ok) throw new Error(data.error); setDraft(data.message ?? ''); setProviderUsed(data.providerUsed ?? false) } catch (error) { setDraft(error instanceof Error ? error.message : 'Draft could not be generated') } finally { setLoading(false) } }
  async function sendFeedback(useful: boolean) { await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recommendationId: current.id, useful }) }); setFeedback(useful ? 'Useful' : 'Not useful') }
  return <div className="fixed inset-0 z-50"><button aria-label="Close contact details" className="absolute inset-0 bg-foreground/40" onClick={onClose} /><div ref={panel} role="dialog" aria-modal="true" aria-labelledby="contact-title" className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-background p-6 shadow-xl">
    <div className="flex items-start justify-between"><div><Badge tone="primary">Priority {rec.priorityScore}</Badge><h2 id="contact-title" className="mt-3 text-2xl font-semibold">{rec.contact.fullName}</h2><p className="text-muted-foreground">{rec.contact.role ?? 'Role not recorded'}{rec.contact.company ? ` · ${rec.contact.company}` : ''}</p></div><button ref={closeButton} onClick={onClose} aria-label="Close" className="rounded-lg border p-2"><X className="size-4" /></button></div>
    <section className="mt-7"><h3 className="font-semibold">Score breakdown</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[['Goal match',rec.matchScore],['Relationship',rec.relationshipScore],['Evidence confidence',rec.evidenceConfidence],['Priority',rec.priorityScore]].map(([name,value]) => <div key={name} className="rounded-lg border p-3"><dt className="text-muted-foreground">{name}</dt><dd className="mt-1 font-semibold">{value}/100</dd></div>)}</dl></section>
    <section className="mt-7"><h3 className="font-semibold">Supporting records</h3>{supporting.length ? <ul className="mt-3 space-y-3">{supporting.map((item) => <li key={item.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between"><Badge tone={item.type === 'WEB' ? 'primary' : 'outline'}>{item.type}</Badge><span className="text-xs text-muted-foreground">{item.source}</span></div><p className="mt-2">{item.detail}</p>{item.url && <a className="mt-2 inline-block text-primary underline" href={item.url} target="_blank" rel="noreferrer">Open source</a>}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No supporting record was attached.</p>}</section>
    <section className="mt-7"><h3 className="font-semibold">Suggested next step</h3><p className="mt-2 text-sm">{rec.suggestedAction}</p><Button className="mt-3" onClick={generate} disabled={loading}>{loading && <Loader2 className="animate-spin" />}{loading ? 'Drafting…' : 'Generate outreach draft'}</Button>{draft && <><textarea aria-label="Generated outreach draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} className="mt-3 w-full rounded-lg border bg-background p-3 text-sm" />{providerUsed != null && <p className="mt-2 text-xs text-muted-foreground">{providerUsed ? 'Generated by the configured AI provider using minimized draft details.' : 'Generated locally without an external AI provider.'}</p>}</>}</section>
    <section className="mt-7 border-t pt-5"><p className="text-sm font-medium">Was this recommendation useful?</p><div className="mt-2 flex gap-2"><Button variant="outline" onClick={() => void sendFeedback(true)}><ThumbsUp />Yes</Button><Button variant="outline" onClick={() => void sendFeedback(false)}><ThumbsDown />No</Button>{feedback && <span className="self-center text-sm text-muted-foreground">Saved: {feedback}</span>}</div></section>
  </div></div>
}
