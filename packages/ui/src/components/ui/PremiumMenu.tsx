import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import {
  filterPremiumMenuItems,
  placeAnchoredMenu,
  PREMIUM_MENU_TOKENS,
  typeaheadIndex,
  virtualizeWindow,
  type PremiumMenuItem,
  type PremiumMenuVariant,
} from './premium-menu-model'

export interface PremiumMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  items: PremiumMenuItem[]
  selectedId?: string | null
  onSelect: (item: PremiumMenuItem) => void
  variant?: PremiumMenuVariant
  closeOnSelect?: boolean
  searchPlaceholder?: string
}

export function PremiumMenu({
  open,
  onOpenChange,
  anchorRef,
  items,
  selectedId,
  onSelect,
  variant = 'regular',
  closeOnSelect = true,
  searchPlaceholder,
}: PremiumMenuProps) {
  const { t } = useTranslation()
  const tokens = PREMIUM_MENU_TOKENS[variant]
  const [query, setQuery] = React.useState('')
  const [highlighted, setHighlighted] = React.useState(0)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [placement, setPlacement] = React.useState<ReturnType<typeof placeAnchoredMenu> | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const typeaheadRef = React.useRef({ buffer: '', at: 0 })

  const filtered = React.useMemo(
    () => filterPremiumMenuItems(items, query, (item) => item.label),
    [items, query],
  )

  const windowSlice = React.useMemo(
    () => virtualizeWindow({
      count: filtered.length,
      rowHeight: tokens.rowHeight,
      scrollTop,
      viewportHeight: placement?.maxHeight ?? tokens.maxHeight,
    }),
    [filtered.length, tokens.rowHeight, scrollTop, placement?.maxHeight, tokens.maxHeight],
  )

  const updatePlacement = React.useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setPlacement(placeAnchoredMenu({
      anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      menuWidth: Math.max(220, rect.width),
      menuHeight: tokens.maxHeight,
    }))
  }, [anchorRef, tokens.maxHeight])

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlighted(0)
    setScrollTop(0)
    updatePlacement()
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    const onViewport = () => updatePlacement()
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open, updatePlacement])

  const selectIndex = React.useCallback((index: number) => {
    const item = filtered[index]
    if (!item || item.disabled) return
    onSelect(item)
    if (closeOnSelect) onOpenChange(false)
  }, [filtered, onSelect, closeOnSelect, onOpenChange])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filtered.length === 0) return
      setHighlighted((prev) => (prev + 1) % filtered.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length === 0) return
      setHighlighted((prev) => (prev - 1 + filtered.length) % filtered.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectIndex(highlighted)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      anchorRef.current?.focus()
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && query.length === 0) {
      const now = Date.now()
      const state = typeaheadRef.current
      state.buffer = now - state.at > 600 ? event.key : `${state.buffer}${event.key}`
      state.at = now
      const next = typeaheadIndex(filtered, state.buffer, (item) => item.label, highlighted)
      if (next >= 0) setHighlighted(next)
    }
  }

  if (!open || !placement || typeof document === 'undefined') return null

  const visible = filtered.slice(windowSlice.start, windowSlice.end)

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-floating-backdrop" onClick={() => onOpenChange(false)} />
      <div
        role="listbox"
        data-premium-menu=""
        data-variant={variant}
        className="fixed z-floating-menu overflow-hidden bg-background text-foreground"
        style={{
          top: placement.top,
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
          borderRadius: tokens.radius,
          boxShadow: tokens.shadow,
          fontSize: tokens.fontSize,
        }}
      >
        <div className="border-b border-border/50 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder ?? t('common.search')}
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">{t('premiumMenu.empty')}</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">{t('premiumMenu.noResults')}</div>
        ) : (
          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ maxHeight: Math.max(96, placement.maxHeight - 44) }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: windowSlice.height, position: 'relative' }}>
              <div style={{ transform: `translateY(${windowSlice.offsetY}px)` }}>
                {visible.map((item, offset) => {
                  const index = windowSlice.start + offset
                  const highlightedRow = index === highlighted
                  const selected = item.id === selectedId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={item.disabled}
                      data-highlighted={highlightedRow}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => selectIndex(index)}
                      className={cn(
                        'flex w-full items-center text-left outline-none',
                        highlightedRow && 'bg-foreground/5',
                        selected && 'bg-foreground/3',
                        item.disabled && 'opacity-40',
                      )}
                      style={{
                        height: tokens.rowHeight,
                        paddingLeft: tokens.padX,
                        paddingRight: tokens.padX,
                      }}
                    >
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
