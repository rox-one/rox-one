import * as React from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export const COLLECTION_MENU_ROW =
  'group/row flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:bg-foreground/[0.04]'

export function CollectionMenuCheck({
  selected,
  className,
}: {
  selected: boolean
  className?: string
}) {
  return (
    <span className={cn('grid h-3.5 w-3.5 shrink-0 place-items-center', className)} aria-hidden>
      <Check
        className={cn(
          'h-3 w-3 text-foreground transition-opacity duration-150',
          selected ? 'opacity-100' : 'opacity-0',
        )}
        strokeWidth={2.25}
      />
    </span>
  )
}

export function CollectionMenuRow({
  selected,
  label,
  onClick,
  trailing,
  className,
}: {
  selected: boolean
  label: React.ReactNode
  onClick: () => void
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(COLLECTION_MENU_ROW, selected && 'text-foreground', className)}
    >
      <CollectionMenuCheck selected={selected} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function CollectionMenuRadioRow({
  selected,
  label,
  onClick,
  className,
}: {
  selected: boolean
  label: React.ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(COLLECTION_MENU_ROW, selected && 'text-foreground', className)}
    >
      <CollectionMenuCheck selected={selected} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function CollectionMenuSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" role="group" aria-label={label}>
      <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  )
}

export function CollectionMenuDisclosure({
  label,
  valueLabel,
  children,
  defaultOpen = false,
}: {
  label: string
  valueLabel: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(COLLECTION_MENU_ROW, 'text-foreground')}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="max-w-[7rem] truncate text-[11px] text-muted-foreground">{valueLabel}</span>
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150',
            open && 'rotate-90',
          )}
          strokeWidth={2}
        />
      </button>
      {open ? <div className="pb-0.5">{children}</div> : null}
    </div>
  )
}
