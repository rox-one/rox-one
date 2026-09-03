import * as React from 'react'
import { cn } from '../../lib/utils'
import { PremiumMenu } from './PremiumMenu'
import type { PremiumMenuVariant } from './premium-menu-model'

export interface PremiumMenuSelectOption {
  id: string
  label: string
  disabled?: boolean
}

export interface PremiumMenuSelectProps {
  items: PremiumMenuSelectOption[]
  placeholder: string
  onSelect: (item: PremiumMenuSelectOption) => void
  variant?: PremiumMenuVariant
  searchable?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Action-style select trigger for bulk bars and compact filters.
 * Does not keep a committed value — native bulk selects reset after change.
 */
export function PremiumMenuSelect({
  items,
  placeholder,
  onSelect,
  variant = 'compact',
  searchable,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: PremiumMenuSelectProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const shouldSearch = searchable ?? items.length > 12

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
        {placeholder}
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        items={items}
        getKey={(item) => item.id}
        getLabel={(item) => item.label}
        onSelect={(item) => {
          if (item.disabled) return
          onSelect(item)
        }}
        searchable={shouldSearch}
        variant={variant}
        preferredSide="bottom"
        closeOnSelect
      />
    </>
  )
}
