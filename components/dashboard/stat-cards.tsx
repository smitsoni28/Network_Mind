import { Card } from '@/components/ui/card'
import { Users, Target, Snowflake, Sparkles } from 'lucide-react'
const icons = [Users, Target, Snowflake, Sparkles]
export function StatCards({ values }: { values: Array<{ label: string; value: number; detail: string }> }) {
  return <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{values.map((item, index) => { const Icon = icons[index]; return <Card key={item.label} className="p-5"><Icon className="size-5 text-primary" /><p className="mt-4 text-2xl font-semibold tabular-nums">{item.value}</p><p className="text-sm text-muted-foreground">{item.label}</p><p className="mt-2 text-xs text-muted-foreground">{item.detail}</p></Card> })}</div>
}
