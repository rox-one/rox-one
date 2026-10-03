import { useTourSignals, useTourTarget, TourRuntimeContext, TourScopeContext } from '@/features/product-tour/runtime/hooks'
import { beginCollectionViewChange, consumeCollectionViewChange, hasCollectionViewChange } from '@/features/product-tour/runtime/collection-view-observation'
import { measureTargetGeometry } from '@/features/product-tour/ui/geometry'
import { observeTargetGeometry } from '@/features/product-tour/ui/geometry-observer'
import { useNavigationState, isSessionsNavigation } from '@/contexts/NavigationContext'
import * as React from 'react'
import { CalendarRange, ChevronDown, LayoutGrid, List, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PremiumMenu } from '@/components/ui/premium-menu'
import { useHotkeyLabel } from '@/actions/useHotkeyLabel'
import { cn } from '@/lib/utils'
import type { CollectionViewMode } from '../kanban/BoardListToggle'
import {
  COLLECTION_VIEW_ORDER,
  rememberCollectionView,
  resolveCycleTarget,
} from './collection-view-cycle'

const ICONS = {
  list: List,
  board: LayoutGrid,
  table: Table2,
  heatmap: CalendarRange,
} as const

const LABEL_KEY: Record<CollectionViewMode, string> = {
  list: 'collection.view.list',
  board: 'collection.view.board',
  table: 'collection.view.table',
  heatmap: 'collection.view.heatmap',
}

export interface CollectionViewCycleButtonProps {
  value: CollectionViewMode
  onChange: (mode: CollectionViewMode) => void
  className?: string
}

export function CollectionViewCycleButton({ value, onChange, className }: CollectionViewCycleButtonProps) {
  const { t } = useTranslation()
  const navigation = useNavigationState()
  const isSessionCollection = isSessionsNavigation(navigation)
  const requestedDestination = isSessionsNavigation(navigation) && navigation.filter.kind === 'allSessions'
    && !navigation.details && (navigation.viewMode ?? 'list') === value
  const runtime = React.useContext(TourRuntimeContext)
  const scope = React.useContext(TourScopeContext)
  const owner = runtime?.observationOwner ?? runtime
  const viewTarget = useTourTarget('sessions.view-switcher')
  const tourSignals = useTourSignals()
  const viewElement = React.useRef<HTMLDivElement | null>(null)
  const registerView = React.useCallback((element: HTMLDivElement | null) => {
    viewElement.current = element
    if (isSessionCollection) viewTarget(element)
  }, [isSessionCollection, viewTarget])
  React.useEffect(() => {
    const element = viewElement.current
    if (!requestedDestination || !runtime?.enabled || !owner || !scope || !element) return
    const current = tourSignals.capture()
    if (!current || !hasCollectionViewChange(owner, current.binding, scope, value)) return
    let completed = false
    let stop = () => {}
    // A prop change alone is insufficient: the requested destination must have
    // committed, remain in the captured scope, and be visible through clipping.
    const complete = () => {
      const observation = consumeCollectionViewChange(owner, tourSignals.capture(), scope, value, !!measureTargetGeometry(element))
      if (observation) {
        completed = true
        stop()
        tourSignals.emit(observation, 'sessions.view-visible', 'observed', 'ui-observation')
      } else {
        const active = tourSignals.capture()
        if (!active || !hasCollectionViewChange(owner, active.binding, scope, value)) stop()
      }
    }
    complete()
    if (!completed) stop = observeTargetGeometry(element, complete)
    return () => stop()
  }, [value, requestedDestination, runtime, owner, scope, tourSignals])
  const [menuOpen, setMenuOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const Icon = ICONS[value]
  const next = resolveCycleTarget(value, 'next')
  const prev = resolveCycleTarget(value, 'prev')
  const nextHotkey = useHotkeyLabel('collection.viewNext')
  const prevHotkey = useHotkeyLabel('collection.viewPrev')
  const listHotkey = useHotkeyLabel('collection.viewList')
  const boardHotkey = useHotkeyLabel('collection.viewBoard')
  const tableHotkey = useHotkeyLabel('collection.viewTable')
  const heatmapHotkey = useHotkeyLabel('collection.viewHeatmap')
  const modeHotkeys: Record<CollectionViewMode, string | null> = {
    list: listHotkey,
    board: boardHotkey,
    table: tableHotkey,
    heatmap: heatmapHotkey,
  }

  const applyMode = React.useCallback((mode: CollectionViewMode) => {
    if (isSessionCollection && owner) beginCollectionViewChange(owner, tourSignals.capture(), mode, value)
    if (mode !== value) rememberCollectionView(value)
    onChange(mode)
  }, [onChange, value, isSessionCollection, owner, tourSignals])

  const nextLabel = t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })
  const prevLabel = t('collection.view.cyclePrev', { mode: t(LABEL_KEY[prev]) })
  const title = [
    nextHotkey ? `${nextLabel} (${nextHotkey})` : nextLabel,
    prevHotkey ? `${prevLabel} (${prevHotkey})` : prevLabel,
  ].join(' · ')

  const buttonClass =
    'inline-flex h-7 items-center justify-center text-muted-foreground transition-colors group-hover/cycle:bg-foreground/3 group-hover/cycle:text-foreground hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground'

  const menuItems = COLLECTION_VIEW_ORDER.map((mode) => {
    const hotkey = modeHotkeys[mode]
    const label = t(LABEL_KEY[mode])
    return {
      id: mode,
      label: hotkey ? `${label}  ${hotkey}` : label,
    }
  })

  return (
    <div
      ref={registerView}
      className={cn('group/cycle inline-flex items-stretch rounded-[4px]', className)}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <button
        type="button"
        className={cn(buttonClass, 'w-7 rounded-l-[4px]')}
        aria-label={nextLabel}
        aria-keyshortcuts="Alt+V Alt+Shift+V"
        title={title}
        onClick={(event) => {
          applyMode(resolveCycleTarget(value, event.shiftKey ? 'prev' : 'next'))
        }}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        ref={triggerRef}
        type="button"
        className={cn(buttonClass, 'w-4 rounded-r-[4px]')}
        aria-label={`${t('collection.view.list')} / ${t('collection.view.board')} / ${t('collection.view.table')} / ${t('collection.view.heatmap')}`}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        data-state={menuOpen ? 'open' : 'closed'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </button>
      <PremiumMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={triggerRef}
        items={menuItems}
        selectedId={value}
        onSelect={(item) => {
          applyMode(item.id as CollectionViewMode)
        }}
        variant="compact"
      />
    </div>
  )
}
