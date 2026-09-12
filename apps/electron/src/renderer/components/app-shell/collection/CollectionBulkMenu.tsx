import * as React from 'react'
import { PremiumMenu, type PremiumMenuItem } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export interface CollectionBulkMenuProps {
  label: string
  items: PremiumMenuItem[]
  disabled?: boolean
  onPick: (id: string) => void
  className?: string
}

/** Compact PremiumMenu trigger used by the floating collection bulk bar. */
export function CollectionBulkMenu({
  label,
  items,
  disabled = false,
  onPick,
  className,
}: CollectionBulkMenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || items.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground/80 hover:bg-foreground/[0.03] disabled:opacity-50',
          className,
        )}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        items={items}
        onSelect={(item) => onPick(item.id)}
        variant="compact"
      />
    </>
  )
}
