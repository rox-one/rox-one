import * as React from 'react'
import type { ComponentEntry } from './types'
import { PremiumMenu, PremiumMenuSelect, PREMIUM_MENU_VARIANTS } from '@craft-agent/ui'
import type { PremiumMenuVariant } from '@craft-agent/ui'

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    label: `Provider ${String(index).padStart(4, '0')}`,
  }))
}

function PremiumMenuStory(props: {
  itemCount: number
  variant: PremiumMenuVariant
  narrow?: boolean
  searchable?: boolean
}) {
  const items = React.useMemo(() => makeItems(props.itemCount), [props.itemCount])
  const [open, setOpen] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState(items[Math.min(42, items.length - 1)]?.id ?? '')
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const tokens = PREMIUM_MENU_VARIANTS[props.variant]

  return (
    <div className="flex min-h-[420px] w-full flex-col items-start gap-3 p-6">
      <div className="text-xs text-muted-foreground">
        {props.itemCount} items · {props.variant}
        {props.narrow ? ' · narrow' : ''}
      </div>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="h-8 rounded-md border border-border bg-background px-3 text-sm"
      >
        {items.find((item) => item.id === selectedId)?.label ?? 'Open menu'}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        items={items}
        getKey={(item) => item.id}
        getLabel={(item) => item.label}
        isSelected={(item) => item.id === selectedId}
        onSelect={(item) => setSelectedId(item.id)}
        variant={props.variant}
        searchable={props.searchable ?? true}
        closeOnSelect={false}
        minWidth={props.narrow ? 160 : tokens.minWidth}
        maxWidth={props.narrow ? 180 : tokens.maxWidth}
      />
    </div>
  )
}

function CompactSelectStory() {
  const items = React.useMemo(() => makeItems(50), [])
  const [last, setLast] = React.useState('none')
  return (
    <div className="flex min-h-[240px] items-start gap-3 p-6">
      <PremiumMenuSelect
        variant="compact"
        placeholder="Filter labels"
        items={items}
        onSelect={(item) => setLast(item.label)}
      />
      <span className="text-xs text-muted-foreground">{last}</span>
    </div>
  )
}

export const premiumMenuComponents: ComponentEntry[] = [
  {
    id: 'premium-menu-5',
    name: 'Premium menu · 5 items',
    category: 'Controls',
    description: 'Compact searchable menu with five rows. Deterministic playground fixture.',
    component: PremiumMenuStory,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
    mockData: () => ({ itemCount: 5, variant: 'compact' }),
  },
  {
    id: 'premium-menu-50',
    name: 'Premium menu · 50 items',
    category: 'Controls',
    description: 'Regular variant with fifty rows and keyboard search.',
    component: PremiumMenuStory,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
    mockData: () => ({ itemCount: 50, variant: 'regular' }),
  },
  {
    id: 'premium-menu-1000',
    name: 'Premium menu · 1,000 items',
    category: 'Controls',
    description: 'Virtualized inspector menu. Open stays within the 80ms dropdown-open budget.',
    component: PremiumMenuStory,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
    mockData: () => ({ itemCount: 1000, variant: 'inspector' }),
  },
  {
    id: 'premium-menu-narrow',
    name: 'Premium menu · narrow panel',
    category: 'Controls',
    description: 'Collision-clamped menu in a 180px panel.',
    component: PremiumMenuStory,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
    mockData: () => ({ itemCount: 50, variant: 'compact', narrow: true }),
  },
  {
    id: 'premium-menu-select',
    name: 'Premium menu select',
    category: 'Controls',
    description: 'Compact trigger used by the collection bulk bar.',
    component: CompactSelectStory,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
  },
]
