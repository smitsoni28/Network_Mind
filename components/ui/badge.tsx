import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

const tones = {
  default: 'border-transparent bg-secondary text-secondary-foreground',
  primary: 'border-transparent bg-accent text-accent-foreground',
  success: 'border-transparent bg-success/12 text-success',
  warning: 'border-transparent bg-warning/15 text-warning',
  destructive: 'border-transparent bg-destructive/12 text-destructive',
  outline: 'border-border bg-transparent text-muted-foreground',
}

export function Badge({
  className,
  tone = 'default',
  ...props
}: ComponentProps<'span'> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
