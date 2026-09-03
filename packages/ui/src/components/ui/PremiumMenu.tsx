import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import {
  PREMIUM_MENU_TYPEAHEAD_RESET_MS,
  PREMIUM_MENU_VARIANTS,
  PREMIUM_MENU_VIRTUALIZE_AFTER,
  filterMenuItems,
  getVirtualWindow,
  matchTypeahead,
  placeAnchoredMenu,
  reduceMenuKey,
  scrollTopToRevealIndex,
  type PremiumMenuSide,
  type PremiumMenuVariant,
} from './premium-menu-model'

export interface PremiumMenuItemState {
  selected: boolean
  highlighted: boolean
}

export interface PremiumMenuProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  items: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  isSelected?: (item: T) => boolean
  onSelect: (item: T) => void
  renderItem?: (item: T, state: PremiumMenuItemState, index: number) => React.ReactNode
  searchable?: boolean
  filterPlaceholder?: string
  emptyState?: React.ReactNode
  noResultsState?: React.ReactNode
  closeOnSelect?: boolean
  variant?: PremiumMenuVariant
  preferredSide?: PremiumMenuSide
  minWidth?: number
  maxWidth?: number
  maxHeight?: number
  restoreFocus?: boolean
}

export function PremiumMenu<T>({
  open,
  onOpenChange,
  anchorRef,
  items,
  getKey,
  getLabel,
  isSelected,
  onSelect,
  renderItem,
  searchable = true,
  filterPlaceholder,
  emptyState,
  noResultsState,
  closeOnSelect = true,
  variant = 'regular',
  preferredSide = 'bottom',
  minWidth,
  maxWidth,
  maxHeight,
  restoreFocus = true,
}: PremiumMenuProps<T>) {
  const { t } = useTranslation()
  const tokens = PREMIUM_MENU_VARIANTS[variant]
  const resolvedPlaceholder = filterPlaceholder ?? t('premiumMenu.search')
  const [filter, setFilter] = React.useState('')
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const previousFocusRef = React.useRef<HTMLElement | null>(null)
  const typeaheadRef = React.useRef({ buffer: '', timeout: 0 })
  const wasOpenRef = React.useRef(false)

  const filteredItems = React.useMemo(
    () => filterMenuItems(items, filter, getLabel),
    [items, filter, getLabel],
  )

  const itemHeight = tokens.itemHeight
  const viewportHeight = maxHeight ?? tokens.maxHeight
  const virtualize = filteredItems.length > PREMIUM_MENU_VIRTUALIZE_AFTER
  const windowSlice = React.useMemo(
    () => getVirtualWindow({
      itemCount: filteredItems.length,
      itemHeight,
      scrollTop,
      viewportHeight,
      overscan: tokens.overscan,
    }),
    [filteredItems.length, itemHeight, scrollTop, viewportHeight, tokens.overscan],
  )
  const visibleItems = virtualize
    ? filteredItems.slice(windowSlice.start, windowSlice.end)
    : filteredItems

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(
      maxWidth ?? tokens.maxWidth,
      Math.max(minWidth ?? tokens.minWidth, rect.width),
    )
    const next = placeAnchoredMenu({
      anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      menu: { width, height: viewportHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      preferred: preferredSide,
    })
    setPosition({ top: next.top, left: next.left })
  }, [anchorRef, maxWidth, minWidth, preferredSide, tokens.maxWidth, tokens.minWidth, viewportHeight])

  React.useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true
    if (!justOpened) {
      updatePosition()
      return
    }
    const active = document.activeElement
    previousFocusRef.current = active instanceof HTMLElement ? active : null
    setFilter('')
    const selectedIndex = isSelected ? items.findIndex((item) => isSelected(item)) : -1
    const initial = selectedIndex >= 0 ? selectedIndex : 0
    setHighlightedIndex(initial)
    setScrollTop(scrollTopToRevealIndex(initial, itemHeight, viewportHeight, 0))
    updatePosition()
  }, [open, items, isSelected, itemHeight, viewportHeight, updatePosition])

  React.useEffect(() => {
    if (!open) return
    const focusTarget = () => {
      if (searchable) inputRef.current?.focus()
      else listRef.current?.focus()
    }
    const raf = requestAnimationFrame(focusTarget)
    const onViewportChange = () => updatePosition()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, searchable, updatePosition])

  React.useEffect(() => {
    if (highlightedIndex >= filteredItems.length) {
      setHighlightedIndex(Math.max(0, filteredItems.length - 1))
    }
  }, [filteredItems.length, highlightedIndex])

  React.useEffect(() => {
    if (!open || !virtualize) return
    setScrollTop((current) => scrollTopToRevealIndex(highlightedIndex, itemHeight, viewportHeight, current))
  }, [open, virtualize, highlightedIndex, itemHeight, viewportHeight])

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
  }, [open, virtualize, highlightedIndex, filteredItems.length])

  const closeMenu = React.useCallback(() => {
    onOpenChange(false)
    if (!restoreFocus) return
    previousFocusRef.current?.focus()
  }, [onOpenChange, restoreFocus])

  const handleSelect = React.useCallback((item: T) => {
    onSelect(item)
    if (closeOnSelect) closeMenu()
  }, [onSelect, closeOnSelect, closeMenu])

  const applyKey = React.useCallback((event: React.KeyboardEvent) => {
    const result = reduceMenuKey(event.key, {
      highlightedIndex,
      itemCount: filteredItems.length,
    })
    if (result.preventDefault) event.preventDefault()
    if (result.highlightedIndex !== highlightedIndex) setHighlightedIndex(result.highlightedIndex)
    if (result.close) {
      closeMenu()
      return
    }
    if (result.select) {
      const item = filteredItems[result.highlightedIndex]
      if (item) handleSelect(item)
    }
  }, [highlightedIndex, filteredItems, closeMenu, handleSelect])

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
    const labels = filteredItems.map(getLabel)
    const match = matchTypeahead(next, labels, highlightedIndex)
    if (match >= 0) setHighlightedIndex(match)
  }, [searchable, filteredItems, getLabel, highlightedIndex])

  if (!open || !position || typeof document === 'undefined') return null

  const width = Math.min(
    maxWidth ?? tokens.maxWidth,
    Math.max(minWidth ?? tokens.minWidth, anchorRef.current?.getBoundingClientRect().width ?? tokens.minWidth),
  )
  const hasItems = items.length > 0
  const hasResults = filteredItems.length > 0
  const listId = 'premium-menu-list'

  return ReactDOM.createPortal(
    <>
      <div
        className="fixed inset-0 z-floating-backdrop"
        onClick={closeMenu}
      />
      <div
        ref={surfaceRef}
        role="presentation"
        data-premium-menu=""
        data-variant={variant}
        className={cn(tokens.surfaceClass)}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          minWidth: minWidth ?? tokens.minWidth,
          maxWidth: maxWidth ?? tokens.maxWidth,
          width,
        }}
      >
        {!hasItems ? (
          <div className="p-3 text-xs text-muted-foreground select-none">
            {emptyState ?? t('premiumMenu.empty')}
          </div>
        ) : (
          <>
            {searchable && (
              <div className="border-b border-border/50">
                <input
                  ref={inputRef}
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value)
                    setHighlightedIndex(0)
                    setScrollTop(0)
                  }}
                  onKeyDown={applyKey}
                  placeholder={resolvedPlaceholder}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  className={cn(
                    'w-full bg-transparent outline-none placeholder:text-muted-foreground placeholder:select-none',
                    tokens.searchClass,
                  )}
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={searchable ? -1 : 0}
              aria-activedescendant={
                filteredItems[highlightedIndex]
                  ? `premium-menu-option-${getKey(filteredItems[highlightedIndex]!)}`
                  : undefined
              }
              className="overflow-y-auto outline-none"
              style={{ maxHeight: viewportHeight }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onKeyDown={(event) => {
                applyKey(event)
                handleTypeahead(event)
              }}
            >
              {!hasResults ? (
                <div className="px-3 py-2 text-xs text-muted-foreground select-none">
                  {noResultsState ?? t('premiumMenu.noResults')}
                </div>
              ) : (
                <div
                  style={virtualize ? { height: windowSlice.totalHeight, position: 'relative' } : undefined}
                >
                  <div
                    style={virtualize ? { transform: `translateY(${windowSlice.offsetTop}px)` } : undefined}
                  >
                    {visibleItems.map((item, localIndex) => {
                      const index = virtualize ? windowSlice.start + localIndex : localIndex
                      const selected = Boolean(isSelected?.(item))
                      const highlighted = index === highlightedIndex
                      return (
                        <button
                          key={getKey(item)}
                          id={`premium-menu-option-${getKey(item)}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-highlighted={highlighted}
                          data-index={index}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onClick={() => handleSelect(item)}
                          className={cn(
                            'w-full text-left outline-none',
                            !renderItem && cn('flex cursor-pointer select-none items-center', tokens.itemClass),
                            highlighted && 'bg-foreground/5',
                            selected && 'bg-foreground/3',
                          )}
                          style={{ height: itemHeight }}
                        >
                          {renderItem
                            ? renderItem(item, { selected, highlighted }, index)
                            : <span className="truncate">{getLabel(item)}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
