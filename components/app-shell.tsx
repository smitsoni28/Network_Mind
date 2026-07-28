'use client'

import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  MessageSquareText,
  Upload,
  BrainCircuit,
  Menu,
  X,
  Settings,
  HelpCircle,
  LogOut,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ask', label: 'Ask My Network', icon: MessageSquareText },
  { href: '/import', label: 'Import Contacts', icon: Upload },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const [name, setName] = useState('Pilot user')
  useEffect(() => { void fetch('/api/auth/session').then((response) => response.ok ? response.json() : null).then((data: { user?: { displayName?: string } } | null) => data?.user?.displayName && setName(data.user.displayName)) }, [])
  const initials = name.split(/\s/u).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-2 py-2"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BrainCircuit className="size-5" />
        </span>
        <span className="text-base font-semibold tracking-tight">
          NetworkMind
        </span>
      </Link>

      <nav className="mt-2 flex flex-col gap-1">
        {nav.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <Link href="/help" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground">
          <HelpCircle className="size-4" />
          Help & Support
        </Link>
        <Link href="/settings" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground">
          <Settings className="size-4" />
          Settings
        </Link>
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-sidebar-border p-2">
          <Avatar initials={initials} className="size-8 text-xs" index={0} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              Pilot workspace
            </p>
          </div>
          <ThemeToggle />
        </div>
        <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/login'); router.refresh() }} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"><LogOut className="size-4" />Sign out</button>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  if (pathname === '/login') return children

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div role="dialog" aria-modal="true" aria-label="Navigation" className="absolute left-0 top-0 h-full w-72 border-r border-sidebar-border bg-sidebar">
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg border border-border"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BrainCircuit className="size-4" />
            </span>
            NetworkMind
          </span>
          <ThemeToggle />
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
