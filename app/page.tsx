'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Upload, Play, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { GoalInput } from '@/components/dashboard/goal-input'
import { StatCards } from '@/components/dashboard/stat-cards'
import { RecommendationCard } from '@/components/dashboard/recommendation-card'
import { ContactDrawer } from '@/components/dashboard/contact-drawer'
import type { AnalysisResponse, PilotRecommendation } from '@/lib/client-types'

type ContactsPayload = { contacts: Array<{ id: string; source: string }>; stats: { contacts: number; cold: number; recommendations: number }; sampleMode: boolean }
export default function DashboardPage() {
  const router = useRouter(); const [network, setNetwork] = useState<ContactsPayload | null>(null); const [goal, setGoal] = useState(''); const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null); const [selected, setSelected] = useState<PilotRecommendation | null>(null); const [loading, setLoading] = useState(true); const [analyzing, setAnalyzing] = useState(false); const [error, setError] = useState(''); const [consentNeeded, setConsentNeeded] = useState(false)
  const refresh = useCallback(async () => { setLoading(true); try { const [contactsResponse, settingsResponse] = await Promise.all([fetch('/api/contacts'), fetch('/api/settings')]); if (!contactsResponse.ok) throw new Error('Could not load your workspace'); const data = await contactsResponse.json() as ContactsPayload; setNetwork(data); if (settingsResponse.ok) { const settings = await settingsResponse.json() as { dataProcessingConsentAt: string | null }; setConsentNeeded(!settings.dataProcessingConsentAt) } } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load workspace') } finally { setLoading(false) } }, [])
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer) }, [refresh])
  async function loadSample() { setLoading(true); await fetch('/api/contacts/sample', { method: 'POST' }); await refresh() }
  async function analyze() { if (!goal.trim()) return; setAnalyzing(true); setError(''); try { const response = await fetch('/api/analyze-network', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }) }); const data = await response.json() as AnalysisResponse & { error?: string }; if (!response.ok) throw new Error(data.error ?? 'Analysis failed'); setAnalysis(data) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Analysis failed') } finally { setAnalyzing(false) } }
  async function consent() { await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) }); setConsentNeeded(false) }
  const count = network?.stats.contacts ?? 0
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
    {consentNeeded && <Card className="mb-6 border-primary/30 bg-accent p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="text-sm"><strong>Before you begin:</strong> configured AI drafting can use a contact first name plus role and company when present. Web enrichment stays off until you enable it in Settings.</p><Button onClick={consent}>I understand</Button></div></Card>}
    <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><div className="flex gap-2"><Badge tone="primary"><Sparkles className="size-3" />Relationship intelligence</Badge>{network?.sampleMode && <Badge tone="warning">Fictional sample network</Badge>}</div><h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Turn your network into your next opportunity.</h1><p className="mt-3 text-muted-foreground">Import real contacts, find grounded matches, and see the records supporting every recommendation.</p></div><div className="flex flex-wrap gap-3"><Button size="lg" onClick={() => router.push('/import')}><Upload />Import contacts</Button><Button size="lg" variant="outline" onClick={loadSample}><Play />Load sample network</Button></div></section>
    <section className="mt-8">{loading ? <Card className="p-8 text-center"><Loader2 className="mx-auto animate-spin" /></Card> : <StatCards values={[{ label: 'Contacts', value: count, detail: count ? 'Stored in this workspace' : 'Import to get started' },{ label: 'Recommendations', value: network?.stats.recommendations ?? 0, detail: 'Grounded analysis results' },{ label: 'Relationships going cold', value: network?.stats.cold ?? 0, detail: 'Based on timestamps and strength' },{ label: 'Current results', value: analysis?.recommendations.length ?? 0, detail: analysis ? `${analysis.mode.replace('_',' ')} mode` : 'Run an analysis' }]} />}</section>
    <section className="mt-6"><GoalInput goal={goal} onGoalChange={setGoal} onAnalyze={() => void analyze()} analyzing={analyzing} analyzeError={error} disabled={count === 0} /></section>
    <section className="mt-10"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Recommendations</h2><p className="mt-1 text-sm text-muted-foreground">{analysis?.answer ?? (count ? 'Describe a goal to find relevant contacts.' : 'No contacts are stored yet.')}</p></div>{analysis && <Badge tone={analysis.mode === 'WEB' ? 'primary' : analysis.mode === 'VERIFIED_PATH' ? 'success' : 'outline'}>{analysis.mode === 'MIXED' ? 'Web + Network' : analysis.mode === 'VERIFIED_PATH' ? 'Verified path' : analysis.mode[0] + analysis.mode.slice(1).toLowerCase()}</Badge>}</div>
      {analysis?.uncertainty.length ? <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{analysis.uncertainty.join(' ')}</div> : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{analysis?.recommendations.map((rec, index) => <RecommendationCard key={rec.id} rec={rec} index={index} onOpen={() => setSelected(rec)} />)}{analysis && !analysis.recommendations.length && <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">{analysis.answer}</Card>}</div>
    </section>
    <ContactDrawer rec={selected} evidence={analysis?.evidence ?? []} analysisRunId={analysis?.analysisRunId ?? null} onClose={() => setSelected(null)} />
  </div>
}
