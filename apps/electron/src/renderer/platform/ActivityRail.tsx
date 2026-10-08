/**
 * ActivityRail (W1 unified shell, spec S-03 §3.1/§3.2) — vertical navigation
 * rail for top-level destinations (design-compact density).
 *
 * The rail is the seven core modes (A1/TZ) — the same set AppShell's sidebar
 * renders: Дом, Сессии, Встречи, Задачи, Заметки, Лента, Входящие. The list and
 * the active-state predicates come from `CORE_MODES` + `resolveSeededModes`
 * (the seed the titlebar ModeBar consumes), so there is no divergent copy;
 * navigation goes through NavigationContext's `navigate()` (the URL stays the
 * source of truth). Mode-screen-flag-gated modes (`rootRoute: null`) render
 * disabled-with-tooltip. Extra screens continue the list below the modes.
 *
 * Two states, persisted via `activityRailCollapsedAtom`
 * (KEYS.activityRailCollapsed):
 * - expanded (default): icon + text label on every row, accessible «Ещё» group — flat 28px rows on the 4px grid, no borders.
 * - collapsed: icons only, each row keeps a right-side tooltip.
 * The toggle («/») sits at the bottom in both states.
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled, so there is no flag check here.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ChevronsLeft, ChevronsRight, Inbox, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isModeNavigable, type ModeContribution } from '@rox/core/platform'
import { activityRailCollapsedAtom, activityRailNarrowOverrideAtom } from '@/atoms/unified-shell'
import { modeScreenFlagsAtom } from '@/atoms/mode-flags'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { CHROME_DENSITY } from './chrome-density'
import { MODE_ICONS } from './ModeBar'
import { CORE_MODES, resolveSeededModes, type SeededMode } from './modes-seed'
import { ExtraScreensRailGroup } from '../pages/extra-screens/ExtraScreensRailGroup'
import { RailRow } from './RailRow'
import { ModesRailGroup } from './ModesRailGroup'
import { routes, type Route } from '../../shared/routes'

export { RailRow } from './RailRow'

/** Expanded rail width (icon + label) — AppShell offsets the resize sashes by it. */
export const ACTIVITY_RAIL_WIDTH = CHROME_DENSITY.railExpandedWidth
/** Collapsed rail = icons only (same width as the inspector section rail). */
export const ACTIVITY_RAIL_COLLAPSED_WIDTH = CHROME_DENSITY.railWidth

export function activityRailWidth(collapsed: boolean): number {
  return collapsed ? ACTIVITY_RAIL_COLLAPSED_WIDTH : ACTIVITY_RAIL_WIDTH
}

/**
 * Below this window width the expanded rail would push sidebar (180) +
 * navigator (240) + centre (420) + workspace/inspector rails past the edge,
 * so the rail auto-collapses to icons (display-only; persisted state kept).
 */
export const RAIL_AUTO_COLLAPSE_BELOW = 1140

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

export function useNarrowWindow(threshold = RAIL_AUTO_COLLAPSE_BELOW): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth < threshold,
    () => false,
  )
}

export function resolveRailCollapsed(input: { persisted: boolean; narrow: boolean; override: boolean }): boolean {
  return input.persisted || (input.narrow && !input.override)
}

/** Effective rail state shared by the rail and AppShell's sash offset. */
export function useEffectiveRailCollapsed(): {
  collapsed: boolean
  toggle: () => void
} {
  const [persisted, setPersisted] = useAtom(activityRailCollapsedAtom)
  const [override, setOverride] = useAtom(activityRailNarrowOverrideAtom)
  const narrow = useNarrowWindow()
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
  return { collapsed, toggle }
}

const seedById: Record<string, SeededMode> = Object.fromEntries(
  CORE_MODES.map((mode) => [mode.contribution.id, mode]),
)

function RailModeItem({ mode, active, collapsed }: { mode: ModeContribution; active: boolean; collapsed: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const Icon = MODE_ICONS[mode.icon] ?? Inbox
  const label = t(mode.titleKey)
  const disabled = !isModeNavigable(mode)
  return (
    <RailRow
      icon={Icon}
      label={label}
      tooltip={disabled ? `${label} · ${t('workbench.mode.unavailable')}` : label}
      collapsed={collapsed}
      disabled={disabled}
      active={!disabled && active}
      onClick={() => {
        if (mode.rootRoute) void navigate(mode.rootRoute as Route)
      }}
      muted
      testId={`rail-item-${mode.id}`}
    />
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
  const { collapsed, toggle } = useEffectiveRailCollapsed()
  const toggleLabel = collapsed ? t('rail.expand') : t('rail.collapse')
  const navState = useNavigationState()
  const modeFlags = useAtomValue(modeScreenFlagsAtom)
  const modes = resolveSeededModes(
    CORE_MODES.map((mode) => mode.contribution),
    modeFlags,
  )
  const activeId = modes.find((mode) => seedById[mode.id]?.isActive(navState))?.id ?? null

  return (
    <nav
      aria-label={t('rail.title')}
      className={cn(
        'chrome-rail rox-shell-pane rox-shell-divider-r flex h-full shrink-0 flex-col overflow-y-auto overflow-x-hidden py-[8px] font-sans',
        collapsed ? 'items-center' : 'items-stretch px-[8px]',
      )}
      style={{ width: activityRailWidth(collapsed) }}
      data-shell-role="activity-rail"
      data-rail-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <RailSection collapsed={collapsed}>
        {modes.map((mode) => (
          <RailModeItem key={mode.id} mode={mode} active={mode.id === activeId} collapsed={collapsed} />
        ))}
      </RailSection>
      {/* W1-07 (#1504): registered modes in pill order; renders nothing with every mode flag off. */}
      <ModesRailGroup collapsed={collapsed} />
      <ExtraScreensRailGroup collapsed={collapsed} />
      <div className={cn('mt-auto flex flex-col gap-[4px] pt-[8px]', collapsed ? 'items-center' : 'items-stretch')}>
        <RailRow
          icon={Settings}
          label={t('sidebar.settings')}
          collapsed={collapsed}
          muted
          onClick={() => void navigate(routes.view.settings())}
          testId="rail-settings"
        />
        <RailRow
          icon={collapsed ? ChevronsRight : ChevronsLeft}
          label={toggleLabel}
          collapsed={collapsed}
          muted
          onClick={toggle}
          testId="rail-toggle"
        />
      </div>
    </nav>
  )
}
