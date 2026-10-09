/**
 * TabsCore — the single tab system for every surface (spec D2, plan W1.1).
 *
 * One primitive owns the anatomy (heights/glyph/close from tokens), the
 * ARIA tabs pattern (`role=tablist/tab`, `aria-selected`, `aria-controls`,
 * roving tabindex), the full keyboard (Arrow/Home/End, Enter/Space,
 * Delete/Backspace, `Up/Down` in the vertical profile) and middle-click
 * close. Consumers — `platform/SurfaceTabs`, `EntityViewTabs`, the mode-screen
 * kit — are thin configuration adapters with no keyboard/ARIA of their own.
 *
 * Profiles (`variant`): `surface` (panel tabs), `segmented` (view switch),
 * `browser` (compact instance chips). Behaviour never forks per profile; only
 * anatomy differs.
 *
 * Focus/close navigation is the behaviour proven by the existing SurfaceTabs
 * suites and extracted here verbatim: a hidden (filtered-out) active tab still
 * yields a visible roving stop, and closing a background tab restores DOM focus
 * without activating a foreign panel.
 */
import * as React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type TabsVariant = 'surface' | 'segmented' | 'browser'
export type TabsDensity = 'compact' | 'full'
export type TabsOrientation = 'horizontal' | 'vertical'
export type TabsTone = 'default' | 'accent'

export interface TabItem {
  id: string
  label: string
  /** Glyph from the entity dictionary. Size it with a token (`icon-caption`). */
  icon?: React.ReactNode
  badge?: React.ReactNode
  closable?: boolean
  disabled?: boolean
  /** Tooltip / full caption. */
  title?: string
  /** id of the controlled `role=tabpanel` element; rendered as `aria-controls`. */
  controls?: string
}

export interface TabsProps {
  items: readonly TabItem[]
  activeId: string | null
  /** Anatomy profile. Defaults to `surface`. */
  variant?: TabsVariant
  /** `compact` = control-sm height, `full` = control-md height. Defaults to `compact`. */
  density?: TabsDensity
  /** `scroll` keeps one scrollable row; `menu` reserves a trailing overflow slot. */
  overflow?: 'scroll' | 'menu'
  /** Arrow axis: horizontal uses Left/Right, vertical also accepts Up/Down. */
  orientation?: TabsOrientation
  /** Active-item tint. `default` = shell selection, `accent` = accent tint. */
  tone?: TabsTone
  /** Collapse labels under the panel container query (segmented view switch). */
  collapseLabels?: boolean
  /** roving tabindex + ARIA tabs; default true. */
  keyboard?: boolean
  ariaLabel?: string
  /** e.g. the browser-chips menu inside surface tabs. */
  trailing?: React.ReactNode
  className?: string
  /** Base text for the close button (`<closeLabel>: <title>`). */
  closeLabel?: string
  onSelect(id: string): void
  onClose?(id: string): void
}

export interface TabsNavigableItem {
  id: string
  disabled?: boolean
}

/**
 * The tab that owns the strip's single Tab stop: the active item when it is
 * present and enabled, otherwise the first enabled item. A filtered-out active
 * tab therefore still leaves a visible stop.
 */
export function tabRovingId(items: readonly TabsNavigableItem[], activeId: string | null): string | null {
  const active = items.find((item) => item.id === activeId && !item.disabled)
  if (active) return active.id
  return items.find((item) => !item.disabled)?.id ?? null
}

/**
 * Keyboard navigation target. Arrow keys wrap across enabled items and never
 * land on a disabled one; Home/End jump to the first/last enabled item.
 */
export function tabNavigationTarget(
  items: readonly TabsNavigableItem[],
  currentId: string,
  key: string,
  orientation: TabsOrientation = 'horizontal',
): string | null {
  const enabled = items.filter((item) => !item.disabled)
  if (enabled.length === 0) return null
  const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  if (key !== forward && key !== backward && key !== 'Home' && key !== 'End') return null
  if (key === 'Home') return enabled[0]!.id
  if (key === 'End') return enabled[enabled.length - 1]!.id
  const index = enabled.findIndex((item) => item.id === currentId)
  const start = index < 0 ? 0 : index
  const delta = key === forward ? 1 : -1
  return enabled[(start + delta + enabled.length) % enabled.length]!.id
}

/**
 * Surviving tab stop after closing `closingId`. Closing the active tab keeps
 * its neighbour; closing a background tab leaves an independently focused
 * target alone (returns the roving stop of the survivors, without activating).
 */
export function tabCloseTarget(
  items: readonly TabsNavigableItem[],
  closingId: string,
  activeId: string | null,
): string | null {
  const index = items.findIndex((item) => item.id === closingId)
  if (index < 0) return null
  if (closingId === activeId) return items[index + 1]?.id ?? items[index - 1]?.id ?? null
  return tabRovingId(items.filter((item) => item.id !== closingId), activeId)
}

const SURFACE_ACTIVE =
  'bg-[var(--surface-tab-active,var(--shell-selected,var(--element-selected,var(--foreground-5))))] text-foreground'
const SURFACE_INACTIVE =
  'bg-[var(--surface-tab-inactive,transparent)] text-text-secondary hover:bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))] hover:text-foreground'
const SEGMENTED_ACTIVE = 'bg-surface-selected text-foreground'
const SEGMENTED_INACTIVE = 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
const ACCENT_ACTIVE = 'bg-accent/15 font-semibold text-foreground'

const NAVIGATION_KEYS: Record<string, true> = {
  ArrowLeft: true,
  ArrowRight: true,
  ArrowUp: true,
  ArrowDown: true,
  Home: true,
  End: true,
}

export function Tabs({
  items,
  activeId,
  variant = 'surface',
  density = 'compact',
  overflow = 'scroll',
  orientation = 'horizontal',
  tone = 'default',
  collapseLabels = false,
  keyboard = true,
  ariaLabel,
  trailing,
  className,
  closeLabel,
  onSelect,
  onClose,
}: TabsProps) {
  const { t } = useTranslation()
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())

  const tabStopId = React.useMemo(() => tabRovingId(items, activeId), [items, activeId])

  const itemHeight = density === 'full' ? 'h-[var(--control-md)]' : 'h-[var(--control-sm)]'
  const closeText = closeLabel ?? t('common.close')
  const activeClass = tone === 'accent' ? ACCENT_ACTIVE : variant === 'segmented' ? SEGMENTED_ACTIVE : SURFACE_ACTIVE
  const inactiveClass = variant === 'segmented' ? SEGMENTED_INACTIVE : SURFACE_INACTIVE

  // Keep the latest callbacks reachable without re-creating focus helpers on
  // every render (they are called from keydown and close-restoration paths).
  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  const focusItem = React.useCallback((id: string, activate: boolean) => {
    const element = itemRefs.current.get(id)
    if (!element || !element.isConnected || element.getClientRects().length === 0) return
    if (activate) onSelectRef.current(id)
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const requestClose = (item: TabItem, restoreFocus: boolean) => {
    const close = onCloseRef.current
    if (!close) return
    const nextId = restoreFocus ? tabCloseTarget(items, item.id, activeId) : null
    const activate = item.id === activeId
    // A middle-click from an editor must not steal its focus; keyboard and the
    // close button keep focus inside the surviving strip.
    const ownsDOMFocus = restoreFocus &&
      typeof document !== 'undefined' &&
      document.activeElement?.closest<HTMLElement>('[data-tab-item]')?.dataset.tabItem === item.id
    close(item.id)
    if (nextId && ownsDOMFocus) focusItem(nextId, activate)
  }

  const onItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: TabItem) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const { key } = event
    if (NAVIGATION_KEYS[key]) {
      if (!keyboard) return
      const target = tabNavigationTarget(items, item.id, key, orientation)
      if (target) {
        event.preventDefault()
        focusItem(target, true)
      }
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (!item.disabled) onSelectRef.current(item.id)
      return
    }
    if ((key === 'Delete' || key === 'Backspace') && item.closable && onClose) {
      event.preventDefault()
      requestClose(item, true)
    }
  }

  const renderTabButton = (item: TabItem, isTabStop: boolean, extraClasses: string, paint = true) => {
    const active = item.id === activeId
    return (
      <button
        key={item.id}
        type="button"
        role="tab" /* eslint-disable-line rox/prefer-primitives -- this module IS the shared Tabs primitive; consumers must import <Tabs> instead of hand-rolling */
        data-tab={item.id}
        aria-selected={active}
        aria-controls={item.controls}
        aria-label={item.title ?? item.label}
        aria-disabled={item.disabled || undefined}
        disabled={item.disabled}
        tabIndex={keyboard ? (isTabStop ? 0 : -1) : 0}
        title={item.title ?? item.label}
        ref={(element) => {
          if (element) itemRefs.current.set(item.id, element)
          else itemRefs.current.delete(item.id)
        }}
        onClick={() => { if (!item.disabled) onSelectRef.current(item.id) }}
        onKeyDown={(event) => onItemKeyDown(event, item)}
        className={cn(
          'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          extraClasses,
          paint && (active ? activeClass : inactiveClass),
          item.disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {item.icon}
        <span className={cn(
          'min-w-0 truncate',
          variant === 'segmented' && 'whitespace-nowrap',
          variant === 'segmented' && collapseLabels && 'rox-view-switch-label',
        )}
        >
          {item.label}
        </span>
        {item.badge}
      </button>
    )
  }

  const renderItem = (item: TabItem) => {
    const isTabStop = item.id === tabStopId
    // Closing is a per-item affordance only when the tab is closable and the
    // strip was handed a close handler. Closable tabs wear the item wrapper
    // that owns the middle-click surface and the active background.
    if (item.closable && onClose) {
      const active = item.id === activeId
      return (
        <div
          key={item.id}
          data-tab-item={item.id}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              requestClose(item, false)
            }
          }}
          className={cn(
            'group titlebar-no-drag flex max-w-[200px] min-w-0 shrink cursor-default items-center gap-1 rounded-[var(--radius-control)] transition-colors',
            itemHeight,
            variant === 'surface' && 'chrome-label',
            active ? activeClass : inactiveClass,
          )}
        >
          {renderTabButton(item, isTabStop, 'flex h-full min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-control)] pl-2', false)}
          <button
            type="button"
            tabIndex={keyboard ? (isTabStop ? 0 : -1) : 0}
            aria-label={`${closeText}: ${item.title ?? item.label}`}
            onClick={() => requestClose(item, true)}
            className={cn(
              'mr-1 inline-flex size-[var(--icon-inline)] shrink-0 items-center justify-center rounded-[var(--radius-control)] outline-none transition-all hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 group-focus-within:opacity-60',
            )}
          >
            <X className="icon-status" aria-hidden />
          </button>
        </div>
      )
    }

    return renderTabButton(item, isTabStop, cn(
      'inline-flex items-center gap-1 rounded-[var(--radius-control)]',
      variant === 'segmented'
        ? cn('rox-view-switch-item', itemHeight, 'min-w-[var(--control-sm)] justify-center px-1.5 text-xs font-medium')
        : cn(itemHeight, 'px-2.5 text-xs font-medium'),
    ))
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      data-tabs={variant}
      data-overflow={overflow}
      className={cn(
        variant === 'segmented'
          ? 'rox-view-switch titlebar-no-drag inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] p-0.5'
          : cn(
            'flex items-center',
            variant === 'browser' ? 'gap-0.5' : 'gap-1',
            overflow === 'scroll' && 'overflow-x-auto scrollbar-hide',
          ),
        className,
      )}
    >
      {items.map(renderItem)}
      {trailing}
    </div>
  )
}