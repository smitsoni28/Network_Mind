'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Loader2, Sparkles, ArrowRight } from 'lucide-react'
import { useState } from 'react'

const quickActions = [
  { label: 'Find Clients', value: 'clients' },
  { label: 'Find Investors', value: 'investors' },
  { label: 'Find Partners', value: 'partners' },
  { label: 'Find Introductions', value: 'introductions' },
  { label: 'Reconnect', value: 'reconnect' },
]

const presets: Record<string, string> = {
  clients: 'Find potential AI consulting clients in Germany',
  investors: 'Find investors backing early-stage applied AI startups',
  partners: 'Find complementary partners for joint go-to-market deals',
  introductions: 'Find people who can introduce me to startup founders',
  reconnect: 'Reconnect with valuable relationships that have gone cold',
}

export function GoalInput({
  goal,
  onGoalChange,
  onAnalyze,
  analyzing = false,
  analyzeError,
  disabled = false,
}: {
  goal: string
  onGoalChange: (goal: string) => void
  onAnalyze: () => void
  analyzing?: boolean
  analyzeError?: string | null
  disabled?: boolean
}) {
  const [active, setActive] = useState<string | null>(null)

  return (
    <Card className="p-5 sm:p-6">
      <label
        htmlFor="goal"
        className="text-sm font-semibold text-foreground"
      >
        What are you trying to achieve?
      </label>
      <p className="mt-1 text-sm text-muted-foreground">
        Describe your goal and NetworkMind will analyze your network for the
        best matches.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <textarea
            id="goal"
            rows={1}
            value={goal}
            disabled={disabled || analyzing}
            onChange={(e) => onGoalChange(e.target.value)}
            placeholder="Find potential AI consulting clients in Germany"
            className="min-h-11 w-full resize-none rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60"
          />
        </div>
        <Button
          size="lg"
          className="h-11 shrink-0 px-4"
          disabled={disabled || analyzing || !goal.trim()}
          onClick={onAnalyze}
        >
          {analyzing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4" />
          )}
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>

      {analyzeError && (
        <p className="mt-3 text-sm text-destructive">{analyzeError}</p>
      )}

      {disabled && (
        <p className="mt-3 text-sm text-muted-foreground">
          Import contacts or try the demo network before analyzing.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <button
            key={action.value}
            type="button"
            disabled={disabled || analyzing}
            onClick={() => {
              setActive(action.value)
              onGoalChange(presets[action.value])
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
              active === action.value
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    </Card>
  )
}
