import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import './catalog-panel.css'

/** Controls respond to their panel's width, independently of the application window. */
export function CatalogSelect<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
  testId?: string
}) {
  const id = useId()
  return (
    <div className={props.className ?? 'min-w-0'}>
      <label htmlFor={id} className="catalog-label">{props.label}</label>
      <Select value={props.value} onValueChange={(value) => props.onChange(value as T)}>
        <SelectTrigger id={id} data-testid={props.testId} className="h-8 text-[13px]">
          <SelectValue>{props.options.find((option) => option.value === props.value)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CatalogDisclosure(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <details className="catalog-disclosure" data-testid={props.testId}>
      <summary>
        <span className="min-w-0 flex-1">{props.title}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="catalog-disclosure-content">{props.children}</div>
    </details>
  )
}

/** Keep keyboard focus inside this panel when narrow list/detail views exchange places. */
export function useCatalogFocus(selectedId: string | null) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lastSelectedId = useRef(selectedId)
  const lastFocus = useRef<HTMLElement | null>(null)
  const restoreFocus = useCallback(() => {
    const root = rootRef.current
    if (!root || root.closest('[inert], [aria-hidden="true"]') || !root.getClientRects().length) return
    const active = document.activeElement
    const owned = root.contains(active) || (active === document.body && root.contains(lastFocus.current))
    if (!owned) return
    const master = root.querySelector<HTMLElement>('.catalog-master')
    const detail = root.querySelector<HTMLElement>('.catalog-detail')
    if (master && getComputedStyle(master).display === 'none' && master.contains(active === document.body ? lastFocus.current : active)) {
      root.querySelector<HTMLElement>('[data-catalog-detail-heading]')?.focus({ preventScroll: true })
    } else if (detail && getComputedStyle(detail).display === 'none' && detail.contains(active === document.body ? lastFocus.current : active)) {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-catalog-row]'))
      const target = rows.find((row) => row.dataset.catalogRow === lastSelectedId.current) ?? rows[0]
      ;(target ?? root.querySelector<HTMLElement>('[data-catalog-entry]'))?.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    if (selectedId) lastSelectedId.current = selectedId
    restoreFocus()
  }, [selectedId, restoreFocus])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // A display:none switch can reset activeElement to body before the layout effect.
    const onFocus = (event: FocusEvent) => {
      if (event.target !== document.body) lastFocus.current = root.contains(event.target as Node) ? event.target as HTMLElement : null
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) lastFocus.current = null
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('pointerdown', onPointer, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restoreFocus)
    observer?.observe(root)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('pointerdown', onPointer, true)
      observer?.disconnect()
    }
  }, [restoreFocus])
  return rootRef
}
