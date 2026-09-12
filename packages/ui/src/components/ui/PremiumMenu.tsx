import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import {
  filterPremiumMenuItems,
  placeAnchoredMenu,
  PREMIUM_MENU_TOKENS,
  PREMIUM_MENU_TYPEAHEAD_RESET_MS,
  PREMIUM_MENU_VIRTUALIZE_AFTER,
  reduceMenuKey,
  scrollTopToRevealIndex,
  typeaheadIndex,
  virtualizeWindow,
  type PremiumMenuItem,
  type PremiumMenuSide,
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
  searchable?: boolean
  preferredSide?: PremiumMenuSide
  restoreFocus?: boolean
  minWidth?: number
  maxWidth?: number
}

const LIST_ID = 'premium-menu-list'

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
  searchable = true,
  preferredSide = 'below',
  restoreFocus = true,
  minWidth,
  maxWidth,
}: PremiumMenuProps) {
  const { t } = useTranslation()
  const tokens = PREMIUM_MENU_TOKENS[variant]
  const [query, setQuery] = React.useState('')
  const [highlighted, setHighlighted] = React.useState(0)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [placement, setPlacement] = React.useState<ReturnType<typeof placeAnchoredMenu> | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const previousFocusRef = React.useRef<HTMLElement | null>(null)
  const typeaheadRef = React.useRef({ buffer: '', timeout: 0 })
  const wasOpenRef = React.useRef(false)

  const filtered = React.useMemo(
    () => filterPremiumMenuItems(items, query, (item) => item.label),
    [items, query],
  )

  const viewportHeight = placement?.maxHeight ?? tokens.maxHeight
  const virtualize = filtered.length > PREMIUM_MENU_VIRTUALIZE_AFTER
  const windowSlice = React.useMemo(
    () => virtualizeWindow({
      count: filtered.length,
      rowHeight: tokens.rowHeight,
      scrollTop,
      viewportHeight,
      overscan: tokens.overscan,
    }),
    [filtered.length, tokens.rowHeight, scrollTop, viewportHeight, tokens.overscan],
  )

  const updatePlacement = React.useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(
      maxWidth ?? tokens.maxWidth,
      Math.max(minWidth ?? tokens.minWidth, rect.width),
    )
    setPlacement(placeAnchoredMenu({
      anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      menuWidth: width,
      menuHeight: tokens.maxHeight,
      preferred: preferredSide,
    }))
  }, [anchorRef, tokens.maxHeight, tokens.maxWidth, tokens.minWidth, preferredSide, minWidth, maxWidth])

  const closeMenu = React.useCallback(() => {
    onOpenChange(false)
    if (!restoreFocus) return
    previousFocusRef.current?.focus()
  }, [onOpenChange, restoreFocus])

  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true
    if (justOpened) {
      const active = document.activeElement
      previousFocusRef.current = active instanceof HTMLElement ? active : null
      setQuery('')
      const selectedIndex = selectedId
        ? items.findIndex((item) => item.id === selectedId)
        : -1
      const initial = selectedIndex >= 0 ? selectedIndex : 0
      setHighlighted(initial)
      setScrollTop(scrollTopToRevealIndex(initial, tokens.rowHeight, tokens.maxHeight, 0))
    }
    updatePlacement()
    const focusTarget = () => {
      if (searchable) inputRef.current?.focus()
      else listRef.current?.focus()
    }
    const raf = requestAnimationFrame(focusTarget)
    const onViewport = () => updatePlacement()
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open, updatePlacement, searchable, selectedId, items, tokens.rowHeight, tokens.maxHeight])

  React.useEffect(() => {
    if (highlighted >= filtered.length) {
      setHighlighted(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, highlighted])

  React.useEffect(() => {
    if (!open || !virtualize) return
    setScrollTop((current) => scrollTopToRevealIndex(highlighted, tokens.rowHeight, viewportHeight, current))
  }, [open, virtualize, highlighted, tokens.rowHeight, viewportHeight])

  React.useEffect(() => {
    if (!open || !virtualize || !listRef.current) return
    if (Math.abs(listRef.current.scrollTop - scrollTop) > 1) {
      listRef.current.scrollTop = scrollTop
    }
  }, [open, virtualize, scrollTop])

  React.useEffect(() => {
    if (!open || virtualize || !listRef.current) return
    const selected = listRef.current.querySelector<HTMLElement>('[data-highlighted="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [open, virtualize, highlighted, filtered.length])

  const selectIndex = React.useCallback((index: number) => {
    const item = filtered[index]
    if (!item || item.disabled) return
    onSelect(item)
    if (closeOnSelect) closeMenu()
  }, [filtered, onSelect, closeOnSelect, closeMenu])

  const applyKey = React.useCallback((event: React.KeyboardEvent) => {
    const result = reduceMenuKey(event.key, {
      highlightedIndex: highlighted,
      itemCount: filtered.length,
    })
    if (result.preventDefault) event.preventDefault()
    if (result.highlightedIndex !== highlighted) setHighlighted(result.highlightedIndex)
    if (result.close) {
      closeMenu()
      return
    }
    if (result.select) selectIndex(result.highlightedIndex)
  }, [highlighted, filtered.length, closeMenu, selectIndex])

  const handleTypeahead = React.useCallback((event: React.KeyboardEvent) => {
    if (searchable) return
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    const next = `${typeaheadRef.current.buffer}${event.key}`
    typeaheadRef.current.buffer = next
    window.clearTimeout(typeaheadRef.current.timeout)
    typeaheadRef.current.timeout = window.setTimeout(() => {
      typeaheadRef.current.buffer = ''
    }, PREMIUM_MENU_TYPEAHEAD_RESET_MS)
    const match = typeaheadIndex(filtered, next, (item) => item.label, highlighted)
    if (match >= 0) setHighlighted(match)
  }, [searchable, filtered, highlighted])

  if (!open || !placement || typeof document === 'undefined') return null

  const visible = virtualize
    ? filtered.slice(windowSlice.start, windowSlice.end)
    : filtered
  const activeItem = filtered[highlighted]
  const listMaxHeight = searchable
    ? Math.max(96, placement.maxHeight - 44)
    : placement.maxHeight

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-floating-backdrop" onClick={closeMenu} />
      <div
        data-premium-menu=""
        data-variant={variant}
        className={cn(tokens.surfaceClass)}
        style={{
          position: 'fixed',
          top: placement.top,
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
          fontSize: tokens.fontSize,
        }}
      >
        {items.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">{t('premiumMenu.empty')}</div>
        ) : (
          <>
            {searchable && (
              <div className="border-b border-border/50 px-3 py-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setHighlighted(0)
                    setScrollTop(0)
                  }}
                  onKeyDown={applyKey}
                  placeholder={searchPlaceholder ?? t('premiumMenu.search')}
                  aria-controls={LIST_ID}
                  aria-autocomplete="list"
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground">{t('premiumMenu.noResults')}</div>
            ) : (
              <div
                ref={listRef}
                id={LIST_ID}
                role="listbox"
                tabIndex={searchable ? -1 : 0}
                aria-activedescendant={activeItem ? `premium-menu-option-${activeItem.id}` : undefined}
                className="overflow-y-auto outline-none"
                style={{ maxHeight: listMaxHeight }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                onKeyDown={(event) => {
                  applyKey(event)
                  handleTypeahead(event)
                }}
              >
                <div style={virtualize ? { height: windowSlice.height, position: 'relative' } : undefined}>
                  <div style={virtualize ? { transform: `translateY(${windowSlice.offsetY}px)` } : undefined}>
                    {visible.map((item, offset) => {
                      const index = virtualize ? windowSlice.start + offset : offset
                      const highlightedRow = index === highlighted
                      const selected = item.id === selectedId
                      return (
                        <button
                          key={item.id}
                          id={`premium-menu-option-${item.id}`}
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
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
