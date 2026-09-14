import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import type { EntityViewCapability, EntityViewId } from '@/components/app-shell/EntityViewTabs'
import { canFocusNotesControl, isNotesPanelUnavailable } from './focus-state'

export function useNotesPanelWidth<T extends HTMLElement>() {
  const [element, setElement] = React.useState<T | null>(null)
  const ref = React.useCallback((node: T | null) => setElement(node), [])
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!element) return
    const update = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      // Retained, hidden workspace panels must not reset the last useful layout.
      if (next > 0) setWidth((previous) => previous === next ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [ref, width] as const
}

/** Small tiles use the same tools in a focus-trapped sheet; the document stays mounted behind it. */
export function NotesResponsiveRail({
  inline,
  open,
  title,
  onClose,
  children,
  returnFocus,
}: {
  inline: boolean
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const ownerRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  React.useLayoutEffect(() => {
    if (open && !inline) returnFocusRef.current = document.activeElement as HTMLElement | null
  }, [open, inline])
  React.useEffect(() => {
    if (!open) return
    if (inline) { closeRef.current(); return }
    const owner = ownerRef.current
    if (!owner) return
    const check = () => { if (isNotesPanelUnavailable(owner)) closeRef.current() }
    const observer = new MutationObserver(check)
    for (let element: HTMLElement | null = owner; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] })
    }
    owner.ownerDocument.addEventListener('visibilitychange', check)
    check()
    return () => { observer.disconnect(); owner.ownerDocument.removeEventListener('visibilitychange', check) }
  }, [open, inline])
  if (inline) return <div ref={ownerRef} className="contents">{children}</div>
  return (
    <div ref={ownerRef} className="contents">
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="flex h-[min(600px,80dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // There is no DialogTrigger when a menu opens this sheet.
          const target = returnFocus?.current ?? returnFocusRef.current
          if (canFocusNotesControl(target)) target.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="shrink-0 border-b border-border-subtle px-4 py-3 pr-12 text-[13px]">{title}</DialogTitle>
        <div className="flex min-h-0 flex-1 overflow-hidden [&>aside]:!w-full [&>aside]:!border-0">{children}</div>
      </DialogContent>
    </Dialog>
    </div>
  )
}

export function NotesViewMenu({ value, onChange, capabilities, compact = false }: {
  value: EntityViewId
  onChange: (view: EntityViewId) => void
  capabilities: EntityViewCapability[]
  compact?: boolean
}) {
  const { t } = useTranslation()
  const active = capabilities.find((capability) => capability.id === value)
  const Icon = active?.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rox-control shrink-0 gap-1 px-2 text-[12px]" aria-label={`${t('entityView.tabsLabel')}: ${active ? t(active.labelKey) : ''}`}>
          {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          <span className={compact ? 'sr-only' : 'max-w-24 truncate'}>{active ? t(active.labelKey) : t('entityView.tabsLabel')}</span>
          <ChevronDown className="size-3 shrink-0 text-text-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="start" className="w-44">
        {capabilities.filter((capability) => capability.available).map(({ id, labelKey, icon: ViewIcon }) => (
          <StyledDropdownMenuItem key={id} role="menuitemradio" aria-checked={value === id} onSelect={() => onChange(id)}>
            <ViewIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t(labelKey)}</span>
            {value === id ? <Check className="size-3.5" aria-hidden="true" /> : null}
          </StyledDropdownMenuItem>
        ))}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
