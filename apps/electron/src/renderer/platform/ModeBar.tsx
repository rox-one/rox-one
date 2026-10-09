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
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { primaryPanelRouteAtom } from '@/atoms/panel-stack'
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
import { useShellModes } from './useModes'
import { resolveLucideIcon } from './lucide-icon'
import { GLYPH_ICONS_BY_NAME } from './glyphs'
import { surfaceTabFromRoute } from './layout-snapshot'
import { useInboxBlockingCount } from '@/hooks/useInboxItems'
import { handleModePillKeyDown } from './mode-pill-keyboard'
import {
  PILL_BROWSER_SURFACE_ID,
  activatePillSurface,
  recordPillActivation,
  setPillExcluded,
  setPillPinned,
  usePillPreferences,
  visiblePillSurfaces,
  type ResolvedPillSurface,
} from './pill-composition'
import { canOpenPillBrowser, useOpenPillBrowser } from './pill-activate'
import { activeScene, applyScene, clearScene, createScene, useScenes, type Scene } from './scenes'

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
}

export interface ModeBarProps {
  /** Icon-only segments (labels move into tooltips). */
  collapsed?: boolean
  /** Reports the natural pill widths so the titlebar can decide when to collapse. */
  onMeasure?: (metrics: ModeBarMetrics) => void
  /**
   * Opens the Пульт for the «Все панели…» item. Defaults to the existing ⌘K
   * omnibox, so the pill needs no dependency on the W1.3 palette slice.
   */
  onOpenPalette?: () => void
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
        const Icon = resolveLucideIcon(surface.icon) ?? MODE_ICONS[surface.icon] ?? Inbox
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
            {!collapsed && <span className="rox-mode-pill-label">{title}</span>}
            {badge > 0 && <span className="rox-mode-pill-badge" aria-hidden>{badge > 99 ? '99+' : badge}</span>}
          </button>
        )

        if (!interactive) return button

        const menuContent = (
          <StyledContextMenuContent>
            <StyledContextMenuItem onSelect={() => onTogglePin?.(surface.id)}>
              {pinned ? <PinOff /> : <Pin />}
              {t(pinned ? 'workbench.pill.unpin' : 'workbench.pill.pin')}
            </StyledContextMenuItem>
            <StyledContextMenuItem onSelect={() => onExclude?.(surface.id)}>
              <EyeOff />
              {t('workbench.pill.exclude')}
            </StyledContextMenuItem>
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
        if (!collapsed) {
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

export function ModeBar({ collapsed = false, onMeasure, onOpenPalette }: ModeBarProps = {}) {
  const { t, i18n } = useTranslation()
  const navState = useNavigationState()
  const { navigate } = useNavigation()
  const { modes } = useShellModes()
  const prefs = usePillPreferences()
  const sceneState = useScenes()
  const scene = useMemo(() => activeScene(sceneState), [sceneState])
  const inboxBlocking = useInboxBlockingCount()
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const primaryRoute = useAtomValue(primaryPanelRouteAtom)
  const openBrowser = useOpenPillBrowser()
  const browserAvailable = canOpenPillBrowser()
  const badges = { inbox: inboxBlocking }

  const [focusId, setFocusId] = useState<string | null>(null)
  const surfaces = useMemo(() => visiblePillSurfaces(modes, prefs, scene), [modes, prefs, scene])
  const available = useMemo(
    () => surfaces.filter((surface) => surface.kind !== 'panel' || browserAvailable),
    [surfaces, browserAvailable],
  )

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
          Boolean(surface.mode && seedById[surface.mode.id]?.isActive(navState)),
      )?.id ?? null
    )
  }, [available, browserActive, navState])

  const rovingId = available.some((surface) => surface.id === focusId)
    ? focusId
    : activeId ?? available[0]?.id ?? null

  const pinnedIds = useMemo(() => new Set(prefs.pinned), [prefs.pinned])
  const handleActivate = useCallback(
    (surface: ResolvedPillSurface) => {
      recordPillActivation(surface.id)
      activatePillSurface(surface, { navigate, openBrowser })
    },
    [navigate, openBrowser],
  )
  const handleTogglePin = useCallback(
    (id: string) => setPillPinned(id, !pinnedIds.has(id)),
    [pinnedIds],
  )
  const handleExclude = useCallback((id: string) => setPillExcluded(id, true), [])
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
    .map((surface) => `${surface.id}:${surface.mode?.rootRoute ? 1 : 0}:${surface.titleKey}`)
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
      const metrics = {
        full: Math.ceil(full.getBoundingClientRect().width),
        compact: Math.ceil(compact.getBoundingClientRect().width),
      }
      const key = `${metrics.full}:${metrics.compact}`
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
          surfaces={available}
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
          </div>
          <div ref={compactGhostRef} aria-hidden className="rox-mode-pill rox-mode-pill-ghost" data-collapsed>
            <PillItems surfaces={available} activeId={null} collapsed interactive={false} badges={badges} />
          </div>
        </>
      )}
    </>
  )
}