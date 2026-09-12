import * as React from 'react'
import { cn } from '../../lib/utils'
import { PremiumMenu } from './PremiumMenu'
import type { PremiumMenuItem, PremiumMenuVariant } from './premium-menu-model'

export interface PremiumMenuSelectProps {
  items: PremiumMenuItem[]
  placeholder: string
  onSelect: (item: PremiumMenuItem) => void
  selectedId?: string | null
  variant?: PremiumMenuVariant
  searchable?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Action-style select trigger for compact filters and bulk bars.
 * Search is on by default once the list exceeds 12 items.
 */
export function PremiumMenuSelect({
  items,
  placeholder,
  onSelect,
  selectedId,
  variant = 'compact',
  searchable,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: PremiumMenuSelectProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const shouldSearch = searchable ?? items.length > 12
  const selectedLabel = selectedId
    ? items.find((item) => item.id === selectedId)?.label
    : undefined

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => {
          if (disabled) return
          setOpen((current) => !current)
        }}
        className={cn(
          'inline-flex h-7 max-w-[160px] items-center truncate rounded-md border border-border bg-background px-2 text-xs text-foreground/80',
          'hover:bg-foreground/[0.03] disabled:opacity-50',
          open && 'bg-foreground/[0.03]',
          className,
        )}
      >
        {selectedLabel ?? placeholder}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        items={items}
        selectedId={selectedId}
        onSelect={(item) => {
          if (item.disabled) return
          onSelect(item)
        }}
        searchable={shouldSearch}
        variant={variant}
        closeOnSelect
      />
    </>
  )
}
