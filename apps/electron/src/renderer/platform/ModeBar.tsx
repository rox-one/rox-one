/**
 * Mode Bar — the titlebar pill (ADR-0001, D1 «Пилюля v3»).
 *
 * The pill's membership is DATA (`pill-composition.ts`): the starter set is
 * Лента · Команда · Агент · Заметки · Браузер, reordered by explicit
 * pins/exclusions and by a per-session-frozen usage counter. Right-clicking an
 * item pins/excludes it (Radix context menu); «Все панели…» opens the Пульт.
 *
 * Modes present in the registry but absent from the composition (Задачи,
 * Встречи, Входящие, …) are reachable from the Пульт; the pill no longer
 * renders every registered mode, and unavailable modes are dropped rather than
 * shown disabled.
 *
 * Styling lives in `components/app-shell/titlebar-mode-pill.css` (plain CSS);
 * glyph size/stroke and radius come from tokens, not literals.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  Check,
  EyeOff,
  Inbox,
  Layers,
  LayoutGrid,
  Pin,
  PinOff,
  RotateCcw,
  Save,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { useOpenScreen } from '@/components/shell/panel-strip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import { useNavigationState } from '@/contexts/NavigationContext'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { primaryPanelRouteAtom } from '@/atoms/panel-stack'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
  StyledContextMenuSub,
  StyledContextMenuSubContent,
  StyledContextMenuSubTrigger,
} from '@/components/ui/styled-context-menu'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { SEEDED_MODES, type SeededMode } from './modes-seed'
import { usePillModel } from './usePillNav'
import { setNavPlacement } from '../components/app-shell/nav-placement'
import { foldPills } from '../components/app-shell/mode-pill-layout'
import { resolveLucideIcon } from './lucide-icon'
import { GLYPH_ICONS_BY_NAME } from './glyphs'
import { surfaceTabFromRoute } from './layout-snapshot'
import { useInboxBlockingCount } from '@/hooks/useInboxItems'
import { handleModePillKeyDown } from './mode-pill-keyboard'
import {
  PILL_BROWSER_SURFACE_ID,
  activatePillSurface,
  removeFromPillsTarget,
  recordPillActivation,
  resetPillSessionUsage,
  setPillExcluded,
  setPillPinned,
  usePillPreferences,
  type ResolvedPillSurface,
} from './pill-composition'
import { canOpenPillBrowser, useOpenPillBrowser } from './pill-activate'
import { applyScene, clearScene, createScene, useScenes, type Scene } from './scenes'
import { AllScreensMenu } from './AllScreensMenu'

/** Measurement stand-in for the overflow pill (same box as an icon-only item). */
function AllScreensGhost() {
  return <span className="rox-mode-pill-item"><LayoutGrid className="rox-mode-pill-icon" aria-hidden /></span>
}

/**
 * Name → glyph map for seeded modes; the canonical dictionary (`glyphs.ts`).
 * Shared with `platform/ActivityRail.tsx`. The fallback `resolveLucideIcon`
 * still resolves names outside the dictionary (wave-2 modes, plugins).
 */
export const MODE_ICONS: Record<string, LucideIcon> = GLYPH_ICONS_BY_NAME

const seedById: Record<string, SeededMode> = Object.fromEntries(
  SEEDED_MODES.map((mode) => [mode.contribution.id, mode]),
)

export interface ModeBarMetrics {
  /** Pill width with icons + labels. */
  full: number
  /** Pill width with icons only. */
  compact: number
  /** Icon-only advance per pill (top50 #3 fold into «…»). */
  advances?: number[]
}

export interface ModeBarProps {
  /** Icon-only segments (labels move into tooltips). */
  collapsed?: boolean
  /** Pills kept in the bar; the rest fold into the «…» menu (active pill never folds). */
  visibleCount?: number
  /** Reports the natural pill widths so the titlebar can decide when to collapse. */
  onMeasure?: (metrics: ModeBarMetrics) => void
  /**
   * Opens the Пульт for the «Все панели…» item. Defaults to the existing ⌘K
   * omnibox, so the pill needs no dependency on the W1.3 palette slice.
   */
  onOpenPalette?: () => void
  /** Host browser opener for the «Все экраны» Браузер row (WebUI has no embedded panel). */
  onOpenBrowser?: () => void
}

function itemBadge(badges: Readonly<Record<string, number>> | undefined, id: string): number {
  return badges?.[id] ?? 0
}

interface PillItemsProps {
  surfaces: readonly ResolvedPillSurface[]
  activeId: string | null
  collapsed: boolean
  interactive: boolean
  /** Id of the single tabbable item (roving tabindex). */
  rovingId?: string | null
  itemRefs?: MutableRefObject<Map<string, HTMLButtonElement>>
  /** Per-mode counters (Входящие: requests blocking an agent). */
  badges?: Readonly<Record<string, number>>
  pinnedIds?: ReadonlySet<string>
  onActivate?: (surface: ResolvedPillSurface) => void
  onFocusItem?: (id: string) => void
  onTogglePin?: (id: string) => void
  onExclude?: (id: string) => void
  onOpenPalette?: () => void
  scenes?: readonly Scene[]
  activeSceneId?: string | null
  onApplyScene?: (id: string) => void
  onClearScene?: () => void
  onSaveScene?: () => void
}

function PillItems({
  surfaces,
  activeId,
  collapsed,
  interactive,
  rovingId,
  itemRefs,
  badges,
  pinnedIds,
  onActivate,
  onFocusItem,
  onTogglePin,
  onExclude,
  onOpenPalette,
  scenes = [],
  activeSceneId = null,
  onApplyScene,
  onClearScene,
  onSaveScene,
}: PillItemsProps) {
  const { t } = useTranslation()
  return (
    <>
      {surfaces.map((surface) => {
        const Icon = surface.iconComponent ?? resolveLucideIcon(surface.icon) ?? MODE_ICONS[surface.icon] ?? Inbox
        const iconOnly = collapsed || surface.iconOnly === true
        const title = t(surface.titleKey)
        const active = surface.id === activeId
        const badge = itemBadge(badges, surface.id)
        const pinned = pinnedIds?.has(surface.id) ?? false
        const button = (
          <button
            key={surface.id}
            ref={
              itemRefs
                ? (el) => {
                    if (el) itemRefs.current.set(surface.id, el)
                    else itemRefs.current.delete(surface.id)
                  }
                : undefined
            }
            type="button"
            tabIndex={interactive ? (rovingId === surface.id ? 0 : -1) : -1}
            data-mode={surface.id}
            data-kind={surface.kind}
            data-icon-only={surface.iconOnly || undefined}
            aria-label={badge ? `${title} · ${t('workbench.mode.badge', { count: badge })}` : title}
            aria-current={active ? 'page' : undefined}
            onFocus={interactive && onFocusItem ? () => onFocusItem(surface.id) : undefined}
            onClick={
              interactive && onActivate
                ? (event) => {
                    // Middle-click / ⌘-click must keep their native meaning.
                    if (event.button !== 0 || event.metaKey || event.ctrlKey) return
                    onActivate(surface)
                  }
                : undefined
            }
            className="rox-mode-pill-item titlebar-no-drag"
          >
            <Icon className="rox-mode-pill-icon" aria-hidden />
            {!iconOnly && <span className="rox-mode-pill-label">{title}</span>}
            {badge > 0 && <span className="rox-mode-pill-badge" aria-hidden>{badge > 99 ? '99+' : badge}</span>}
          </button>
        )

        if (!interactive) return button

        const menuContent = (
          <StyledContextMenuContent>
            {/* Placement-added screens (not registry modes) are managed in Settings, not by pin. */}
            {!surface.isActive && (
              <StyledContextMenuItem onSelect={() => onTogglePin?.(surface.id)}>
                {pinned ? <PinOff /> : <Pin />}
                {t(pinned ? 'workbench.pill.unpin' : 'workbench.pill.pin')}
              </StyledContextMenuItem>
            )}
            {!surface.iconOnly && (
              <StyledContextMenuItem onSelect={() => onExclude?.(surface.id)}>
                <EyeOff />
                {t('workbench.pill.exclude')}
              </StyledContextMenuItem>
            )}
            <StyledContextMenuSeparator />
            <StyledContextMenuSub>
              <StyledContextMenuSubTrigger>
                <Layers />
                {t('workbench.scenes.menu')}
              </StyledContextMenuSubTrigger>
              <StyledContextMenuSubContent>
                {scenes.length === 0 && (
                  <StyledContextMenuItem disabled>{t('workbench.scenes.empty')}</StyledContextMenuItem>
                )}
                {scenes.map((scene) => (
                  <StyledContextMenuItem key={scene.id} onSelect={() => onApplyScene?.(scene.id)}>
                    <Check className={scene.id === activeSceneId ? undefined : 'opacity-0'} aria-hidden />
                    {scene.name}
                  </StyledContextMenuItem>
                ))}
                <StyledContextMenuSeparator />
                <StyledContextMenuItem disabled={!activeSceneId} onSelect={() => onClearScene?.()}>
                  <RotateCcw />
                  {t('workbench.scenes.clear')}
                </StyledContextMenuItem>
                <StyledContextMenuItem onSelect={() => onSaveScene?.()}>
                  <Save />
                  {t('workbench.scenes.saveAs')}
                </StyledContextMenuItem>
              </StyledContextMenuSubContent>
            </StyledContextMenuSub>
            {onOpenPalette && (
              <>
                <StyledContextMenuSeparator />
                <StyledContextMenuItem onSelect={onOpenPalette}>
                  <LayoutGrid />
                  {t('workbench.pill.allSurfaces')}
                </StyledContextMenuItem>
              </>
            )}
          </StyledContextMenuContent>
        )

        // Expanded + labelled: no tooltip noise; just the context menu.
        if (!iconOnly) {
          return (
            <ContextMenu key={surface.id}>
              <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
              {menuContent}
            </ContextMenu>
          )
        }
        // Collapsed (icon-only): tooltip trigger and context-menu trigger share
        // the one button through a Slot chain.
        return (
          <ContextMenu key={surface.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{title}</TooltipContent>
            </Tooltip>
            {menuContent}
          </ContextMenu>
        )
      })}
    </>
  )
}

export function ModeBar({ collapsed = false, visibleCount, onMeasure, onOpenPalette, onOpenBrowser }: ModeBarProps = {}) {
  const { t, i18n } = useTranslation()
  const navState = useNavigationState()
  const openScreen = useOpenScreen()
  const prefs = usePillPreferences()
  // WP6: the shared selector (same list the sidebar/rail fall back from).
  const { rendered: available, nav: pillNav } = usePillModel(true)
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  // A workspace switch rebuilds the frozen usage snapshot, so the frequency
  // ordering computed in one room never carries into another.
  useEffect(() => {
    resetPillSessionUsage()
  }, [workspaceId])
  const sceneState = useScenes()
  const inboxBlocking = useInboxBlockingCount()
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const primaryRoute = useAtomValue(primaryPanelRouteAtom)
  const openBrowser = useOpenPillBrowser()
  const browserAvailable = canOpenPillBrowser()
  const badges = { inbox: inboxBlocking }

  const [focusId, setFocusId] = useState<string | null>(null)

  const browserActive =
    browserAvailable && surfaceTabFromRoute(primaryRoute ?? '')?.kind === 'browser'
  const activeId = useMemo(() => {
    if (browserActive && available.some((surface) => surface.id === PILL_BROWSER_SURFACE_ID)) {
      return PILL_BROWSER_SURFACE_ID
    }
    return (
      available.find(
        (surface) =>
          surface.kind === 'mode' &&
          Boolean(surface.mode && (surface.isActive ?? seedById[surface.mode.id]?.isActive)?.(navState)),
      )?.id ?? null
    )
  }, [available, browserActive, navState])

  const { shown, folded } = useMemo(
    () => foldPills(available, visibleCount ?? available.length, activeId),
    [available, visibleCount, activeId],
  )
  const rovingId = shown.some((surface) => surface.id === focusId)
    ? focusId
    : (activeId && shown.some((surface) => surface.id === activeId) ? activeId : shown[0]?.id ?? null)

  const pinnedIds = useMemo(() => new Set(prefs.pinned), [prefs.pinned])
  const handleActivate = useCallback(
    (surface: ResolvedPillSurface) => {
      recordPillActivation(surface.id)
      activatePillSurface(surface, { navigate: openScreen, openBrowser })
    },
    [openScreen, openBrowser],
  )
  const handleTogglePin = useCallback(
    (id: string) => setPillPinned(id, !pinnedIds.has(id)),
    [pinnedIds],
  )
  // WP6: «Убрать из пилюль» moves the surface to its default sidebar group
  // (the one placement store Settings uses) — it stays reachable, never hidden.
  const handleExclude = useCallback((id: string) => {
    const surface = available.find((candidate) => candidate.id === id)
    const target = surface ? removeFromPillsTarget(surface, pillNav.surfaces) : null
    if (target) setNavPlacement(target.id, target.placement)
    else setPillExcluded(id, true)
  }, [available, pillNav])
  const handleOpenPalette = useCallback(() => {
    if (onOpenPalette) onOpenPalette()
    else setOmniboxOpen(true)
  }, [onOpenPalette, setOmniboxOpen])

  const [sceneDialogOpen, setSceneDialogOpen] = useState(false)
  const [sceneName, setSceneName] = useState('')
  const handleSaveScene = useCallback(() => {
    setSceneName('')
    setSceneDialogOpen(true)
  }, [])
  const submitScene = useCallback(() => {
    const created = createScene(
      sceneName,
      available.map((surface) => surface.id),
    )
    if (created) setSceneDialogOpen(false)
  }, [sceneName, available])

  const navRef = useRef<HTMLElement | null>(null)
  const fullGhostRef = useRef<HTMLDivElement | null>(null)
  const compactGhostRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)

  const surfaceKey = available
    .map((surface) => `${surface.id}:${surface.mode?.rootRoute ? 1 : 0}:${surface.titleKey}:${surface.iconOnly ? 1 : 0}`)
    .join('|')

  // Sliding indicator geometry follows the active segment.
  const syncIndicator = useCallback(() => {
    const el = activeId ? itemRefs.current.get(activeId) : undefined
    setIndicator((prev) => {
      if (!el) return prev === null ? prev : null
      const next = { x: el.offsetLeft, w: el.offsetWidth }
      return prev && prev.x === next.x && prev.w === next.w ? prev : next
    })
  }, [activeId])

  useLayoutEffect(() => {
    syncIndicator()
  }, [syncIndicator, collapsed, surfaceKey, i18n.language])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => syncIndicator())
    observer.observe(nav)
    return () => observer.disconnect()
  }, [syncIndicator])

  // Enable the slide transition only after the first placement so the
  // indicator never animates in from x=0 on mount.
  useLayoutEffect(() => {
    if (ready || !indicator) return
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, ready])

  // Natural widths for the titlebar's collapse decision (fonts may load late).
  useLayoutEffect(() => {
    const full = fullGhostRef.current
    const compact = compactGhostRef.current
    if (!full || !compact || !onMeasure) return
    let last = ''
    const report = () => {
      // Advance of each icon-only pill = distance to the next item's left edge
      // (the last pill measures to the «…» trigger), so gaps are included.
      const items = Array.from(compact.querySelectorAll<HTMLElement>('.rox-mode-pill-item'))
      const advances: number[] = []
      for (let i = 0; i < items.length - 1; i += 1) {
        advances.push(Math.max(0, Math.ceil(items[i + 1]!.getBoundingClientRect().left - items[i]!.getBoundingClientRect().left)))
      }
      const metrics = {
        full: Math.ceil(full.getBoundingClientRect().width),
        compact: Math.ceil(compact.getBoundingClientRect().width),
        advances,
      }
      const key = `${metrics.full}:${metrics.compact}:${advances.join(',')}`
      if (key === last) return
      last = key
      onMeasure(metrics)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(full)
    observer.observe(compact)
    return () => observer.disconnect()
  }, [onMeasure, surfaceKey, i18n.language])

  return (
    <>
      <nav
        ref={navRef}
        aria-label={t('workbench.modes')}
        className="rox-mode-pill titlebar-no-drag"
        data-collapsed={collapsed || undefined}
        data-ready={ready || undefined}
        data-testid="titlebar-mode-pill"
        onKeyDown={handleModePillKeyDown}
      >
        <span
          aria-hidden
          className="rox-mode-pill-indicator"
          data-visible={indicator ? true : undefined}
          style={indicator ? { width: indicator.w, transform: `translateX(${indicator.x}px)` } : undefined}
        />
        <PillItems
          surfaces={shown}
          activeId={activeId}
          collapsed={collapsed}
          interactive
          rovingId={rovingId}
          itemRefs={itemRefs}
          badges={badges}
          pinnedIds={pinnedIds}
          onActivate={handleActivate}
          onFocusItem={setFocusId}
          onTogglePin={handleTogglePin}
          onExclude={handleExclude}
          onOpenPalette={handleOpenPalette}
          scenes={sceneState.scenes}
          activeSceneId={sceneState.activeSceneId}
          onApplyScene={applyScene}
          onClearScene={clearScene}
          onSaveScene={handleSaveScene}
        />
        {/* Contextual sidebar: the overflow pill lists every screen, so nothing outside the pills is lost. */}
        <AllScreensMenu collapsed={collapsed} onOpenBrowser={onOpenBrowser} foldedIds={folded.map((surface) => surface.id)} />
      </nav>
      <RenameDialog
        open={sceneDialogOpen}
        onOpenChange={setSceneDialogOpen}
        title={t('workbench.scenes.saveTitle')}
        value={sceneName}
        onValueChange={setSceneName}
        onSubmit={submitScene}
        placeholder={t('workbench.scenes.namePlaceholder')}
      />
      {onMeasure && (
        <>
          <div ref={fullGhostRef} aria-hidden className="rox-mode-pill rox-mode-pill-ghost">
            <PillItems surfaces={available} activeId={null} collapsed={false} interactive={false} badges={badges} />
            <AllScreensGhost />
          </div>
          <div ref={compactGhostRef} aria-hidden className="rox-mode-pill rox-mode-pill-ghost" data-collapsed>
            <PillItems surfaces={available} activeId={null} collapsed interactive={false} badges={badges} />
            <AllScreensGhost />
          </div>
        </>
      )}
    </>
  )
}