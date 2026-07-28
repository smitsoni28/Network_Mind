import { cn } from '@/lib/utils'

const palettes = [
  'bg-chart-1/15 text-chart-1',
  'bg-chart-2/15 text-chart-2',
  'bg-chart-3/20 text-chart-3',
  'bg-chart-4/15 text-chart-4',
]

export function Avatar({
  initials,
  className,
  index = 0,
}: {
  initials: string
  className?: string
  index?: number
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full font-semibold',
        palettes[index % palettes.length],
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}
