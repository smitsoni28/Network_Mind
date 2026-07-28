import { cn } from '@/lib/utils'

function toneFor(value: number) {
  if (value >= 85) return 'text-success'
  if (value >= 70) return 'text-primary'
  return 'text-warning'
}

export function ScoreRing({
  value,
  size = 44,
  label,
}: {
  value: number
  size?: number
  label?: string
}) {
  const stroke = 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn('transition-all duration-700', toneFor(value))}
          stroke="currentColor"
        />
      </svg>
      <span
        className={cn(
          'absolute text-sm font-semibold tabular-nums',
          toneFor(value),
        )}
      >
        {value}
      </span>
      {label && <span className="sr-only">{label}</span>}
    </div>
  )
}

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        {value}%
      </span>
    </div>
  )
}
