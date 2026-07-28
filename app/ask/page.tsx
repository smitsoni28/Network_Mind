'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, BrainCircuit, ExternalLink, Loader2, Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { AnalysisResponse, ConversationHistoryMessage, ConversationListItem, EvidenceView, PilotRecommendation } from '@/lib/client-types'

type Message = { id: string; question: string; networkOnly: boolean; answer?: AnalysisResponse; error?: string; loading?: boolean; loadingMore?: boolean }
const suggestions = ['Who have I not contacted recently?', 'I’m thinking about connecting to ppl in marketing', 'Who in my network works in manufacturing?', 'Research AI startup investment activity in Germany and show me which people in my network may be relevant.']
const modeLabel = { DIRECT: 'Direct', CLARIFICATION: 'Clarification', WEB: 'Web', NETWORK: 'Network', MIXED: 'Mixed', VERIFIED_PATH: 'Verified path', DRAFT: 'Draft message' }

function responseFromPayload(payload: unknown): AnalysisResponse | null {
  if (!payload || typeof payload !== 'object') return null
  const response = (payload as { response?: unknown }).response
  return response && typeof response === 'object' && 'answer' in response ? response as AnalysisResponse : null
}

function messagesFromHistory(history: ConversationHistoryMessage[]): Message[] {
  const messages: Message[] = []
  for (const item of history) {
    if (item.role === 'USER') messages.push({ id: item.id, question: item.text, networkOnly: false })
    if (item.role === 'ASSISTANT') {
      const response = responseFromPayload(item.structuredPayload)
      const last = messages[messages.length - 1]
      const fallback: AnalysisResponse = { mode: item.messageType === 'CLARIFICATION' ? 'CLARIFICATION' : 'DIRECT', intent: item.intent ?? 'UNKNOWN', answer: item.text, totalMatches: 0, displayedCount: 0, offset: 0, hasMore: false, recommendations: [], evidence: [], sources: [], topicSources: [], contactVerificationSources: [], uncertainty: [], searchedAt: null, externalProvidersUsed: [], analysisRunId: null }
      if (last && !last.answer) last.answer = response ?? fallback
      else messages.push({ id: item.id, question: 'Follow-up', networkOnly: false, answer: response ?? fallback })
    }
  }
  return messages
}

function groupConversations(items: ConversationListItem[]) {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups: Array<{ label: string; items: ConversationListItem[] }> = []
  const labels = new Map<string, ConversationListItem[]>()
  for (const item of items) {
    const updated = new Date(item.updatedAt)
    const day = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime()
    const age = Math.floor((startToday - day) / 86_400_000)
    const label = age <= 0 ? 'Today' : age === 1 ? 'Yesterday' : age <= 7 ? 'Previous 7 days' : age <= 30 ? 'Previous 30 days' : updated.toLocaleString(undefined, { month: 'long', year: 'numeric' })
    labels.set(label, [...(labels.get(label) ?? []), item])
  }
  for (const label of ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days']) {
    const rows = labels.get(label)
    if (rows?.length) groups.push({ label, items: rows })
    labels.delete(label)
  }
  for (const [label, rows] of labels) if (rows.length) groups.push({ label, items: rows })
  return groups
}

export default function AskPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('New conversation')
  const [input, setInput] = useState('')
  const [networkOnly, setNetworkOnly] = useState(false)
  const [pending, setPending] = useState(false)
  const [sidebarLoading, setSidebarLoading] = useState(true)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [sidebarError, setSidebarError] = useState('')
  const [conversationError, setConversationError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const groups = useMemo(() => groupConversations(conversations), [conversations])

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages])
  useEffect(() => { setCollapsed(window.localStorage.getItem('networkmind.sidebarCollapsed') === 'true') }, [])
  useEffect(() => { window.localStorage.setItem('networkmind.sidebarCollapsed', String(collapsed)) }, [collapsed])
  useEffect(() => {
    void refreshConversations().then(() => {
      const id = new URLSearchParams(window.location.search).get('conversation')
      if (id) void loadConversation(id, false)
    })
    const pop = () => {
      const id = new URLSearchParams(window.location.search).get('conversation')
      if (id) void loadConversation(id, false)
      else startNewConversation(false)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  useEffect(() => {
    if (!drawerOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawerOpen])

  async function refreshConversations() {
    setSidebarError('')
    setSidebarLoading(true)
    try {
      const response = await fetch('/api/ask-network')
      const data = await response.json() as { conversations?: ConversationListItem[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not load conversations')
      setConversations(data.conversations ?? [])
    } catch (cause) {
      setSidebarError(cause instanceof Error ? cause.message : 'Could not load conversations')
    } finally {
      setSidebarLoading(false)
    }
  }

  async function loadConversation(id: string, push = true) {
    const seq = ++loadSeq.current
    setConversationLoading(true)
    setConversationError('')
    setMessages([])
    try {
      const response = await fetch(`/api/ask-network?conversationId=${encodeURIComponent(id)}`)
      const data = await response.json() as { conversation?: ConversationListItem; messages?: ConversationHistoryMessage[]; error?: string }
      if (seq !== loadSeq.current) return
      if (!response.ok || !data.conversation) throw new Error(data.error ?? 'Could not load conversation')
      setConversationId(data.conversation.id)
      setConversationTitle(data.conversation.title)
      setMessages(messagesFromHistory(data.messages ?? []))
      if (push) window.history.pushState({}, '', `/ask?conversation=${encodeURIComponent(data.conversation.id)}`)
      setDrawerOpen(false)
    } catch (cause) {
      if (seq === loadSeq.current) setConversationError(cause instanceof Error ? cause.message : 'Could not load conversation')
    } finally {
      if (seq === loadSeq.current) setConversationLoading(false)
    }
  }

  function startNewConversation(push = true) {
    loadSeq.current += 1
    setConversationId(null)
    setConversationTitle('New conversation')
    setMessages([])
    setConversationError('')
    setDrawerOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
    if (push) window.history.pushState({}, '', '/ask')
  }

  async function send(value: string) {
    const question = value.trim()
    if (!question || pending) return
    const messageId = crypto.randomUUID()
    setPending(true)
    setConversationError('')
    setMessages((items) => [...items, { id: messageId, question, networkOnly, loading: true }])
    setInput('')
    try {
      const response = await fetch('/api/ask-network', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, ...(conversationId ? { conversationId } : {}), networkOnly, offset: 0 }) })
      const data = await response.json() as AnalysisResponse & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Question could not be answered')
      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId)
        window.history.pushState({}, '', `/ask?conversation=${encodeURIComponent(data.conversationId)}`)
      }
      if (data.conversationTitle) setConversationTitle(data.conversationTitle)
      setMessages((items) => items.map((item) => item.id === messageId ? { ...item, loading: false, answer: data } : item))
      await refreshConversations()
    } catch (cause) {
      setMessages((items) => items.map((item) => item.id === messageId ? { ...item, loading: false, error: cause instanceof Error ? cause.message : 'Question could not be answered' } : item))
    } finally {
      setPending(false)
    }
  }

  async function deleteConversation(conversation: ConversationListItem, event: React.MouseEvent) {
    event.stopPropagation()
    if (!window.confirm(`Delete conversation "${conversation.title}"?`)) return
    setDeletingId(conversation.id)
    setSidebarError('')
    try {
      const response = await fetch(`/api/ask-network?conversationId=${encodeURIComponent(conversation.id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not delete conversation')
      const remaining = conversations.filter((item) => item.id !== conversation.id)
      setConversations(remaining)
      if (conversation.id === conversationId) {
        const next = remaining[0]
        if (next) await loadConversation(next.id)
        else startNewConversation()
      }
    } catch (cause) {
      setSidebarError(cause instanceof Error ? cause.message : 'Could not delete conversation')
    } finally {
      setDeletingId(null)
    }
  }

  async function showMore(message: Message) {
    if (!message.answer || message.loadingMore) return
    setMessages((items) => items.map((item) => item.id === message.id ? { ...item, loadingMore: true } : item))
    try {
      const response = await fetch('/api/ask-network', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: message.question, ...(conversationId ? { conversationId } : {}), networkOnly: message.networkOnly, offset: message.answer.recommendations.length }) })
      const page = await response.json() as AnalysisResponse & { error?: string }
      if (!response.ok) throw new Error(page.error ?? 'More results could not be loaded')
      setMessages((items) => items.map((item) => {
        if (item.id !== message.id || !item.answer) return item
        const recommendations = [...item.answer.recommendations, ...page.recommendations]
        const evidence = [...item.answer.evidence, ...page.evidence].filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
        return { ...item, loadingMore: false, answer: { ...item.answer, recommendations, evidence, displayedCount: recommendations.length, hasMore: page.hasMore, answer: `Found ${page.totalMatches} relevant contacts. Showing ${recommendations.length}.` } }
      }))
    } catch (cause) {
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, loadingMore: false, error: cause instanceof Error ? cause.message : 'More results could not be loaded' } : item))
    }
  }

  const sidebar = <Sidebar collapsed={collapsed} conversations={conversations} groups={groups} activeId={conversationId} loading={sidebarLoading} error={sidebarError} deletingId={deletingId} onRetry={() => void refreshConversations()} onNew={() => startNewConversation()} onCollapse={() => setCollapsed((value) => !value)} onSelect={(id) => void loadConversation(id)} onDelete={(conversation, event) => void deleteConversation(conversation, event)} />

  return <div className="flex h-[calc(100vh-57px)] overflow-hidden lg:h-screen">
    <div className="hidden lg:block">{sidebar}</div>
    {drawerOpen && <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Conversation history"><button type="button" aria-label="Close conversation history" className="absolute inset-0 bg-black/35" onClick={() => setDrawerOpen(false)} /><div className="relative h-full">{sidebar}</div></div>}
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="border-b px-4 py-4 sm:px-6"><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><Button type="button" size="icon" variant="ghost" className="lg:hidden" aria-label="Open conversation history" onClick={() => setDrawerOpen(true)}><Menu /></Button><span className="rounded-lg bg-accent p-2"><BrainCircuit className="size-5" /></span><div className="min-w-0"><h1 className="truncate font-semibold">{conversationTitle}</h1><p className="truncate text-sm text-muted-foreground">Web, private-network, and verified-path answers stay visibly distinct.</p></div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={networkOnly} onChange={(event) => setNetworkOnly(event.target.checked)} /><ShieldCheck className="size-4" />Network only</label></div></header>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6"><div className="mx-auto max-w-4xl py-6">{conversationLoading ? <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading conversation…</p> : conversationError ? <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{conversationError}</div> : messages.length === 0 ? <EmptyState onSend={(value) => void send(value)} /> : <div className="space-y-7">{messages.map((message) => <article key={message.id} data-testid="conversation-turn"><div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{message.question}</div><div className="mt-3 flex gap-3" data-testid="assistant-message"><span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent"><BrainCircuit className="size-4" /></span><div className="min-w-0 flex-1">{message.loading ? <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Understanding request…</p> : message.error ? <p className="text-sm text-destructive">{message.error}</p> : message.answer && <Answer response={message.answer} loadingMore={!!message.loadingMore} onShowMore={() => void showMore(message)} />}</div></div></article>)}</div>}<div ref={bottom} /></div></div>
      <form onSubmit={(event) => { event.preventDefault(); void send(input) }} className="border-t bg-background px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-4xl gap-2"><input ref={inputRef} aria-label="Ask a question" maxLength={1000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about your network or current web information…" className="h-12 min-w-0 flex-1 rounded-xl border bg-card px-4 text-sm" disabled={pending || conversationLoading} /><Button type="submit" size="icon" className="mt-1" disabled={!input.trim() || pending || conversationLoading} aria-label="Send">{pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}</Button></div></form>
    </main>
  </div>
}

function Sidebar({ collapsed, conversations, groups, activeId, loading, error, deletingId, onRetry, onNew, onCollapse, onSelect, onDelete }: { collapsed: boolean; conversations: ConversationListItem[]; groups: Array<{ label: string; items: ConversationListItem[] }>; activeId: string | null; loading: boolean; error: string; deletingId: string | null; onRetry: () => void; onNew: () => void; onCollapse: () => void; onSelect: (id: string) => void; onDelete: (conversation: ConversationListItem, event: React.MouseEvent) => void }) {
  return <nav aria-label="Conversation history" className={`${collapsed ? 'w-[76px]' : 'w-[292px]'} flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width]`}>
    <div className="flex items-center justify-between gap-2 border-b p-3"><div className={`flex items-center gap-2 ${collapsed ? 'sr-only' : ''}`}><BrainCircuit className="size-5" /><span className="font-semibold">NetworkMind</span></div><Button type="button" size="icon" variant="ghost" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
    <div className="p-3"><Button type="button" className="w-full justify-start" variant="outline" onClick={onNew}><Plus />{!collapsed && 'New conversation'}</Button></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {loading ? <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p> : error ? <div className="m-2 rounded-lg border p-3 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" className="mt-2" onClick={onRetry}>Retry</Button></div> : conversations.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{collapsed ? 'Empty' : 'No conversations yet'}</p> : groups.map((group) => <section key={group.label} className="mt-3">
        <h2 className={`px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${collapsed ? 'sr-only' : ''}`}>{group.label}</h2>
        <div className="mt-1 space-y-1">{group.items.map((conversation) => {
          const active = conversation.id === activeId
          return <div key={conversation.id} className={`group flex items-center rounded-lg ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <button type="button" aria-current={active ? 'page' : undefined} title={conversation.title} onClick={() => onSelect(conversation.id)} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm outline-none ring-primary focus-visible:ring-2">
              <span className="block truncate">{collapsed ? conversation.title.slice(0, 1).toUpperCase() : conversation.title}</span>
            </button>
            {!collapsed && <span className="px-1 text-[11px] opacity-70">{new Date(conversation.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
            {!collapsed && <button type="button" aria-label={`Delete conversation ${conversation.title}`} onClick={(event) => onDelete(conversation, event)} className="mr-1 rounded p-1 opacity-0 outline-none ring-primary hover:bg-background/40 focus-visible:ring-2 group-hover:opacity-100 focus:opacity-100">{deletingId === conversation.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}</button>}
          </div>
        })}</div>
      </section>)}
    </div>
  </nav>
}

function EmptyState({ onSend }: { onSend: (value: string) => void }) {
  return <div className="py-12 text-center"><BrainCircuit className="mx-auto size-10 text-primary" /><h2 className="mt-4 text-xl font-semibold">What would you like to know?</h2><p className="mt-2 text-sm text-muted-foreground">Ask about your imported contacts, reconnect opportunities, or current public information.</p><div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">{suggestions.map((suggestion) => <button type="button" key={suggestion} className="rounded-lg border p-3 text-left text-sm hover:bg-muted" onClick={() => onSend(suggestion)}>{suggestion}</button>)}</div></div>
}

function Answer({ response, loadingMore, onShowMore }: { response: AnalysisResponse; loadingMore: boolean; onShowMore: () => void }) {
  const privateEvidence = response.evidence.filter((item) => item.type !== 'WEB')
  const topicSources = response.topicSources ?? response.sources
  return <div><div className="flex flex-wrap items-center gap-2"><Badge tone={response.mode === 'VERIFIED_PATH' ? 'success' : response.mode === 'WEB' ? 'primary' : 'outline'}>{modeLabel[response.mode]}</Badge>{response.externalProvidersUsed.map((provider) => <Badge key={provider} tone="outline">External: {provider}</Badge>)}</div><p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{response.answer}</p>
    {response.recommendations.length > 0 && <div className="mt-4 space-y-3">{response.recommendations.map((rec) => <RecommendationResultCard key={rec.id} rec={rec} evidence={privateEvidence.filter((item) => item.contactId === rec.contact.id)} analysisRunId={rec.analysisRunId ?? response.analysisRunId ?? ''} />)}</div>}
    {response.hasMore && <Button type="button" variant="outline" className="mt-4" disabled={loadingMore} onClick={onShowMore}>{loadingMore && <Loader2 className="animate-spin" />}{loadingMore ? 'Loading…' : 'Show more'}</Button>}
    {topicSources.length > 0 && <section className="mt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public web sources</h3><ul className="mt-2 space-y-2">{topicSources.map((source) => <li key={source.url}><a className="flex items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted" href={source.url} target="_blank" rel="noreferrer"><ExternalLink className="mt-0.5 size-4 shrink-0 text-primary" /><span><strong>{source.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{source.source}</span></span></a></li>)}</ul></section>}
    {response.mode === 'MIXED' && <div className="mt-4 grid gap-3 sm:grid-cols-2"><EvidenceBlock title="Public sources" count={topicSources.length} detail={response.publicProfile ?? 'Current web information could not be retrieved.'} /><EvidenceBlock title="Private contact records" count={privateEvidence.length} detail="Stored records used for relevance, not proof of an introduction." /></div>}
    {response.uncertainty.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Uncertainty: {response.uncertainty.join(' ')}</p>}
  </div>
}

function matchLabel(score: number) {
  if (score >= 80) return 'Strong match'
  if (score >= 60) return 'Good match'
  return 'Possible match'
}

function priorityLabel(score: number) {
  if (score >= 80) return 'High priority'
  if (score >= 60) return 'Medium priority'
  return 'Lower priority'
}

function relationshipLabel(rec: PilotRecommendation) {
  if (rec.contact.relationshipStrength === 'STRONG') return 'Strong relationship'
  if (rec.contact.relationshipStrength === 'WARM') return 'Warm relationship'
  if (rec.contact.relationshipStrength === 'COLD') return 'Cold relationship'
  if (rec.relationshipScore >= 70) return 'Strong relationship'
  if (rec.relationshipScore >= 45) return 'Warm relationship'
  return 'Relationship unclear'
}

export function RecommendationResultCard({ rec, evidence, analysisRunId }: { rec: PilotRecommendation; evidence: EvidenceView[]; analysisRunId: string }) {
  const [draftOpen, setDraftOpen] = useState(false)
  const [channel, setChannel] = useState<'LINKEDIN' | 'EMAIL' | 'SMS' | 'OTHER'>('LINKEDIN')
  const [tone, setTone] = useState<'WARM' | 'PROFESSIONAL' | 'CONCISE'>('WARM')
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft] = useState('')
  const [providerUsed, setProviderUsed] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const prefix = `draft-${rec.id}`

  async function generateDraft() {
    setLoading(true); setError(''); setProviderUsed(null)
    try {
      const response = await fetch('/api/generate-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: rec.contact.id, recommendationId: rec.id, analysisRunId, channel, tone, instruction: instruction.trim() || undefined }) })
      const data = await response.json() as { message?: string; error?: string; providerUsed?: boolean }
      if (!response.ok) throw new Error(data.error ?? 'Draft could not be generated')
      setDraft(data.message ?? '')
      setProviderUsed(data.providerUsed ?? false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Draft could not be generated') }
    finally { setLoading(false) }
  }

  return <Card className="p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{rec.contact.fullName}</p>{rec.exactMatch && <Badge tone="success">Exact match</Badge>}</div><p className="text-sm text-muted-foreground">{rec.contact.role ?? 'Role not recorded'}{rec.contact.company ? ` · ${rec.contact.company}` : ''}</p></div><div className="flex flex-wrap items-start gap-2">{!rec.exactMatch && <Badge tone="primary">{matchLabel(rec.matchScore)}</Badge>}<Badge tone="outline">{relationshipLabel(rec)}</Badge><Badge tone="outline">{priorityLabel(rec.priorityScore)}</Badge></div></div>
    {rec.inactiveDays != null && <p className="mt-3 rounded-lg bg-warning/10 p-2 text-sm font-medium text-warning">Inactive for {rec.inactiveDays} days</p>}
    <p className="mt-2 text-sm">{rec.reasoning}</p><p className="mt-2 text-xs text-muted-foreground">Matched: {rec.matchedFields.join(', ')}</p>
    {rec.exactMatch && evidence.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{evidence.map((item) => <li key={item.id}>{item.detail}</li>)}</ul>}
    <Button type="button" variant="outline" className="mt-3" onClick={() => setDraftOpen((open) => !open)} disabled={!analysisRunId}><MessageSquareText />Draft message</Button>
    {draftOpen && <div className="mt-4 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`${prefix}-channel`} className="text-sm font-medium">Channel<select id={`${prefix}-channel`} value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)} className="mt-1 h-10 w-full rounded-lg border bg-background px-2"><option value="LINKEDIN">LinkedIn</option><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="OTHER">Other</option></select></label><label htmlFor={`${prefix}-tone`} className="text-sm font-medium">Tone<select id={`${prefix}-tone`} value={tone} onChange={(event) => setTone(event.target.value as typeof tone)} className="mt-1 h-10 w-full rounded-lg border bg-background px-2"><option value="WARM">Warm</option><option value="PROFESSIONAL">Professional</option><option value="CONCISE">Concise</option></select></label></div><label htmlFor={`${prefix}-instruction`} className="mt-3 block text-sm font-medium">Optional instruction<input id={`${prefix}-instruction`} value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={500} className="mt-1 h-10 w-full rounded-lg border bg-background px-3" /></label><Button type="button" className="mt-3" disabled={loading} onClick={() => void generateDraft()}>{loading && <Loader2 className="animate-spin" />}{loading ? 'Generating…' : 'Generate draft'}</Button>{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}{draft && <><textarea aria-label={`Draft for ${rec.contact.fullName}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} className="mt-3 w-full rounded-lg border bg-background p-3 text-sm" />{providerUsed != null && <p className="mt-2 text-xs text-muted-foreground">{providerUsed ? 'Generated by the configured AI provider using minimized draft details.' : 'Generated locally without an external AI provider.'}</p>}</>}</div>}
  </Card>
}

function EvidenceBlock({ title, count, detail }: { title: string; count: number; detail: string }) { return <div className="rounded-lg border p-3"><p className="text-sm font-semibold">{title} · {count}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div> }
