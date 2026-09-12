import * as React from 'react'
import { PremiumMenu, PremiumMenuSelect, type PremiumMenuItem, type PremiumMenuVariant } from '@craft-agent/ui'
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
  searchable = true,
  selectedIndex = 0,
  narrow = false,
}: {
  count: number
  variant: PremiumMenuVariant
  searchable?: boolean
  selectedIndex?: number
  narrow?: boolean
}) {
  const items = React.useMemo(() => makeItems(count), [count])
  const [open, setOpen] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(
    items[selectedIndex]?.id ?? items[0]?.id ?? null,
  )
  const anchorRef = React.useRef<HTMLButtonElement>(null)

  return (
    <div
      className="flex min-h-[420px] items-start justify-center p-8"
      style={narrow ? { width: 280, maxWidth: 280 } : undefined}
    >
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
        searchable={searchable}
        maxWidth={narrow ? 260 : undefined}
        onSelect={(item) => setSelectedId(item.id)}
      />
    </div>
  )
}

function PremiumMenuSelectPlayground() {
  const items = React.useMemo(() => makeItems(8), [])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  return (
    <div className="flex min-h-[240px] items-start justify-center p-8">
      <PremiumMenuSelect
        items={items}
        placeholder="Status"
        selectedId={selectedId}
        variant="compact"
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
    description: 'Virtualized inspector menu with one thousand items; selected row stays visible.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'inspector-1000', props: { count: 1000, variant: 'inspector', selectedIndex: 42 } }],
    mockData: () => ({ count: 1000, variant: 'inspector', selectedIndex: 42 }),
    layout: 'full',
  },
  {
    id: 'premium-menu-narrow',
    name: 'Premium menu · narrow panel',
    category: 'Premium Menu',
    description: 'Regular 50-item menu constrained to a 280px inspector column.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'narrow-50', props: { count: 50, variant: 'regular', narrow: true } }],
    mockData: () => ({ count: 50, variant: 'regular', narrow: true }),
    layout: 'full',
  },
  {
    id: 'premium-menu-typeahead',
    name: 'Premium menu · typeahead',
    category: 'Premium Menu',
    description: 'Compact 50-item menu without a search field; keyboard typeahead highlights rows.',
    component: PremiumMenuPlayground,
    props: [],
    variants: [{ name: 'typeahead-50', props: { count: 50, variant: 'compact', searchable: false } }],
    mockData: () => ({ count: 50, variant: 'compact', searchable: false }),
    layout: 'full',
  },
  {
    id: 'premium-menu-select',
    name: 'Premium menu · select trigger',
    category: 'Premium Menu',
    description: 'Compact PremiumMenuSelect trigger used by filters and bulk bars.',
    component: PremiumMenuSelectPlayground,
    props: [],
    variants: [{ name: 'compact-select', props: {} }],
    mockData: () => ({}),
    layout: 'full',
  },
]
