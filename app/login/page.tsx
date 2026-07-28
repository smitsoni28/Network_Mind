'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrainCircuit, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Login failed')
      const next = new URLSearchParams(window.location.search).get('next')
      router.replace(next?.startsWith('/') ? next : '/'); router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Login failed') } finally { setLoading(false) }
  }
  return <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
    <Card className="w-full max-w-md p-7">
      <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BrainCircuit /></span><div><h1 className="text-xl font-semibold">NetworkMind</h1><p className="text-sm text-muted-foreground">Single-tenant pilot login</p></div></div>
      <form className="mt-7 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium">Email<input autoFocus autoComplete="username" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border bg-background px-3" required /></label>
        <label className="block text-sm font-medium">Password<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border bg-background px-3" required minLength={8} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" size="lg" disabled={loading}>{loading && <Loader2 className="animate-spin" />}{loading ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">There is no public registration. Ask the pilot administrator for access.</p>
    </Card>
  </main>
}
