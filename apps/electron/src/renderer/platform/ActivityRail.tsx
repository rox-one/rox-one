/**
 * ActivityRail (W1 unified shell, spec S-03 §3.1/§3.2) — vertical navigation
 * rail for top-level destinations (design-compact density).
 *
 * WP5 (#1580): the rail renders the single primary-nav registry
 * (`components/app-shell/primary-nav.ts`) — the same ordered list, groups and
 * flag gating as AppShell's sidebar: the primary group, then a «Ещё»
 * disclosure (registry «Ещё» entries + extra screens). Navigation goes through
 * NavigationContext's `navigate()` (the URL stays the source of truth). A
 * built mode screen whose flag is off renders disabled-with-tooltip. The ⌘1…7
 * mode-pill slots still follow `modes-seed.ts` and are not affected.
 *
 * Two states, persisted via `activityRailCollapsedAtom`
 * (KEYS.activityRailCollapsed):
 * - expanded (default): icon + text label on every row, accessible «Ещё» group — flat 28px rows on the 4px grid, no borders.
 * - collapsed: icons only, each row keeps a right-side tooltip.
 * The toggle («/») sits at the bottom in both states.
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled, so there is no flag check here.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronsLeft, ChevronsRight, LayoutGrid, MoreHorizontal, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activityRailCollapsedAtom, activityRailNarrowOverrideAtom, featureLayoutEngineAtom } from '@/atoms/unified-shell'
import { modeScreenFlagsAtom } from '@/atoms/mode-flags'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '../pages/extra-screens/registry'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { SHELL_BREAKPOINTS } from './viewport-band'
import { CHROME_DENSITY } from './chrome-density'
import { usePillModel } from './usePillNav'
import { resolvePrimaryNav, type ResolvedPrimaryNavEntry } from '../components/app-shell/primary-nav'
import { ExtraScreensRailGroup } from '../pages/extra-screens/ExtraScreensRailGroup'
import { RailRow } from './RailRow'
import { ModesRailGroup } from './ModesRailGroup'
import { layoutDeckOpenAtom } from './LayoutDeck'
import { MissionsRailGroup } from './MissionsRailGroup'
import { useShellModes } from './useModes'
import { routes } from '../../shared/routes'
import { preloadRoute } from '../components/app-shell/route-pages'

export { RailRow } from './RailRow'

/** Expanded rail width (icon + label) — AppShell offsets the resize sashes by it. */
export const ACTIVITY_RAIL_WIDTH = CHROME_DENSITY.railExpandedWidth
/** Collapsed rail = icons only (same width as the inspector section rail). */
export const ACTIVITY_RAIL_COLLAPSED_WIDTH = CHROME_DENSITY.railWidth

export function activityRailWidth(collapsed: boolean): number {
  return collapsed ? ACTIVITY_RAIL_COLLAPSED_WIDTH : ACTIVITY_RAIL_WIDTH
}

/**
 * Below this shell-root width the expanded rail would push sidebar (180) +
 * navigator (240) + centre (420) + workspace/inspector rails past the edge,
 * so the rail auto-collapses to icons (display-only; persisted state kept).
 * Tied to the shell "regular" breakpoint (--shell-bp-regular, 1280).
 */
export const RAIL_AUTO_COLLAPSE_BELOW = SHELL_BREAKPOINTS.regular

/**
 * Container-aware narrow check: measures the shell root (the rail's parent)
 * with a ResizeObserver so a narrow container inside a wide window collapses
 * too, and falls back to the window check when no parent/observer exists.
 */
export function useNarrowRailContainer(threshold = RAIL_AUTO_COLLAPSE_BELOW): {
  narrow: boolean
  railRef: RefObject<HTMLElement>
} {
  const railRef = useRef<HTMLElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const measure = () => {
      const container = railRef.current?.parentElement
      const width = container ? container.getBoundingClientRect().width : window.innerWidth
      setNarrow(width < threshold)
    }
    measure()
    const container = railRef.current?.parentElement
    if (typeof ResizeObserver === 'undefined' || !container) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [threshold])
  return { narrow, railRef }
}

export function resolveRailCollapsed(input: { persisted: boolean; narrow: boolean; override: boolean }): boolean {
  return input.persisted || (input.narrow && !input.override)
}

/** Effective rail state shared by the rail and AppShell's sash offset. */
export function useEffectiveRailCollapsed(): {
  collapsed: boolean
  toggle: () => void
  railRef: RefObject<HTMLElement>
} {
  const [persisted, setPersisted] = useAtom(activityRailCollapsedAtom)
  const [override, setOverride] = useAtom(activityRailNarrowOverrideAtom)
  const { narrow, railRef } = useNarrowRailContainer()
  const collapsed = resolveRailCollapsed({ persisted, narrow, override })
  const toggle = () => {
    if (collapsed) {
      setPersisted(false)
      setOverride(narrow)
    } else {
      setPersisted(true)
      setOverride(false)
    }
  }
  return { collapsed, toggle, railRef }
}

function RailNavItem({ entry, active, collapsed }: { entry: ResolvedPrimaryNavEntry; active: boolean; collapsed: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const label = t(entry.labelKey)
  const disabled = entry.disabled
  // PERF-10 (#1577): preload the destination chunk once the pointer/focus
  // enters the row (disabled rows land nowhere). The preloader memoizes, so
  // repeat events are free and a failed chunk stays retryable; the route error
  // boundary owns the user-visible failure.
  const prefetchOnIntent = () => {
    if (disabled || !entry.preload) return
    void preloadRoute(entry.preload).catch(() => {})
  }
  return (
    <div className="contents" onPointerEnter={prefetchOnIntent} onFocus={prefetchOnIntent}>
      <RailRow
        icon={entry.icon}
        label={label}
        tooltip={disabled ? `${label} · ${t('workbench.mode.unavailable')}` : label}
        collapsed={collapsed}
        disabled={disabled}
        active={!disabled && active}
        onClick={() => {
          if (entry.route) void navigate(entry.route())
        }}
        muted
        testId={`rail-item-${entry.id}`}
      />
    </div>
  )
}

function RailSection({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}>{children}</div>
  )
}

export function ActivityRail() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { collapsed, toggle, railRef } = useEffectiveRailCollapsed()
  const toggleLabel = collapsed ? t('rail.expand') : t('rail.collapse')
  const navState = useNavigationState()
  const modeFlags = useAtomValue(modeScreenFlagsAtom)
  const layoutEngineOn = useAtomValue(featureLayoutEngineAtom)
  const openLayoutDeck = useSetAtom(layoutDeckOpenAtom)
  const { shellFlags } = useShellModes()
  // The rail has no browser opener (AppShell owns it): action-only entries
  // stay in the sidebar. Settings lives in the rail footer.
  // The rail sits beside the TopBar pill: pill-placed surfaces it does not render fall back here.
  const { nav: { placements }, navIds: pillNavIds } = usePillModel(true)
  // Missions render through MissionsRailGroup; the registry row would duplicate it.
  const entries = resolvePrimaryNav({ shellFlags, modeFlags, placements, pillNavIds })
    .filter((entry) => entry.route !== null && !entry.footer && !entry.railOwned)
  const activeId = entries.find((entry) => !entry.disabled && entry.isActive(navState))?.id ?? null
  const primary = entries.filter((entry) => entry.group === 'primary')
  const more = entries.filter((entry) => entry.group === 'more')
  const [moreOpen, setMoreOpen] = useState(false)
  // An active «Ещё» destination keeps the group open so the selection is visible.
  // Extra screens render inside «Ещё»; an active one forces it open too (as the sidebar does).
  const extraScreens = visibleExtraScreens(useAtomValue(enabledExtraScreenIdsAtom))
  const activeExtraScreen = navState.navigator === 'screen' && extraScreens.some((screen) => screen.id === navState.screen)
  const moreForced = more.some((entry) => entry.id === activeId) || activeExtraScreen
  const moreExpanded = moreOpen || moreForced

  return (
    <nav
      ref={railRef}
      aria-label={t('rail.title')}
      className={cn(
        'chrome-rail rox-shell-pane rox-shell-divider-r flex h-full shrink-0 flex-col overflow-y-auto overflow-x-hidden py-[8px] font-sans',
        collapsed ? 'items-center' : 'items-stretch px-[8px]',
      )}
      style={{ width: activityRailWidth(collapsed) }}
      data-shell-role="activity-rail"
      data-rail-state={collapsed ? 'collapsed' : 'expanded'}
    >
      {/* G3 «Миссии» pilot: flag-gated section above the primary group. */}
      <MissionsRailGroup collapsed={collapsed} />
      <RailSection collapsed={collapsed}>
        {primary.map((entry) => (
          <RailNavItem key={entry.id} entry={entry} active={entry.id === activeId} collapsed={collapsed} />
        ))}
      </RailSection>
      {/* W1-07 (#1504): registered modes the registry does not list (wave-2); nothing by default. */}
      <ModesRailGroup collapsed={collapsed} />
      <div className={cn('mt-[12px] flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}>
        <RailRow
          icon={MoreHorizontal}
          label={t('workbench.mode.more')}
          collapsed={collapsed}
          expanded={moreExpanded}
          controls="rail-more-group"
          onClick={() => setMoreOpen(!moreExpanded)}
          locked={moreForced}
          muted
          testId="rail-more"
        />
        {moreExpanded && (
          <div id="rail-more-group" role="group" aria-label={t('workbench.mode.more')} className={cn('flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')} data-testid="rail-more-group">
            {more.map((entry) => (
              <RailNavItem key={entry.id} entry={entry} active={entry.id === activeId} collapsed={collapsed} />
            ))}
            <ExtraScreensRailGroup collapsed={collapsed} />
          </div>
        )}
      </div>
      {/* G4 «Студия»: the layout deck trigger, only while the engine flag is ON. */}
      {layoutEngineOn && (
        <RailSection collapsed={collapsed}>
          <RailRow
            icon={LayoutGrid}
            label={t('layout.deck.title', { defaultValue: 'Раскладка' })}
            tooltip={t('layout.deck.rail', { defaultValue: 'Раскладка (⌘\\)' })}
            collapsed={collapsed}
            onClick={() => openLayoutDeck(true)}
            testId="rail-layout-deck"
          />
        </RailSection>
      )}
      <div className={cn('mt-auto flex flex-col gap-[4px] border-t border-border-subtle pt-[8px]', collapsed ? 'items-center' : 'items-stretch')}>
        <RailRow
          icon={Settings}
          label={t('sidebar.settings')}
          collapsed={collapsed}
          onClick={() => void navigate(routes.view.settings())}
          testId="rail-settings"
        />
        <RailRow
          icon={collapsed ? ChevronsRight : ChevronsLeft}
          label={toggleLabel}
          collapsed={collapsed}
          onClick={toggle}
          testId="rail-toggle"
        />
      </div>
    </nav>
  )
}
