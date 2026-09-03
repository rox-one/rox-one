import * as React from 'react'
import { PremiumMenu, type PremiumMenuItem, type PremiumMenuVariant } from '@craft-agent/ui'
import type { ComponentEntry } from './types'

function makeItems(count: number): PremiumMenuItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${String(i).padStart(4, '0')}`,
  }))
}

function PremiumMenuPlayground({
  count,
  variant,
}: {
  count: number
  variant: PremiumMenuVariant
}) {
  const items = React.useMemo(() => makeItems(count), [count])
  const [open, setOpen] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(items[0]?.id ?? null)
  const anchorRef = React.useRef<HTMLButtonElement>(null)

  return (
    <div className="flex min-h-[420px] items-start justify-center p-8">
      <button
        ref={anchorRef}
        type="button"
        className="rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm"
        onClick={() => setOpen((value) => !value)}
      >
        {selectedId ?? 'open menu'}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        items={items}
        selectedId={selectedId}
        variant={variant}
        onSelect={(item) => setSelectedId(item.id)}
      />
    </div>
  )
}

export const premiumMenuComponents: ComponentEntry[] = [
  {
    id: 'premium-menu-5',
    name: 'Premium menu · 5 items',
    category: 'Premium Menu',
    description: 'Compact searchable menu with five items.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'compact-5', props: { count: 5, variant: 'compact' } }],
    mockData: () => ({ count: 5, variant: 'compact' }),
    layout: 'full',
  },
  {
    id: 'premium-menu-50',
    name: 'Premium menu · 50 items',
    category: 'Premium Menu',
    description: 'Regular searchable menu with fifty items.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'regular-50', props: { count: 50, variant: 'regular' } }],
    mockData: () => ({ count: 50, variant: 'regular' }),
    layout: 'full',
  },
  {
    id: 'premium-menu-1000',
    name: 'Premium menu · 1000 items',
    category: 'Premium Menu',
    description: 'Virtualized inspector menu with one thousand items.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'inspector-1000', props: { count: 1000, variant: 'inspector' } }],
    mockData: () => ({ count: 1000, variant: 'inspector' }),
    layout: 'full',
  },
]
