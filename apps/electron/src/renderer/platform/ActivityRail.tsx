/**
 * ActivityRail (W1 unified shell, spec S-03 §3.1/§3.2) — vertical navigation
 * rail for top-level destinations (design-compact density).
 *
 * The destinations list mirrors AppShell's `links[]` via the shared
 * `APP_NAV_DESTINATIONS` config (no divergent copy); navigation goes through
 * NavigationContext's `navigate()` (the URL stays the source of truth).
 * Wave-gated destinations (`route: null`) render disabled-with-tooltip unless
 * they carry an `action` (the browser reuses the existing native/WebUI opener
 * instead of inventing a route); Knowledge navigates since W2 (flag-off state
 * lives in the surface).
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
import { useAtom, useSetAtom } from 'jotai'
import { ChevronsLeft, ChevronsRight, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activityRailCollapsedAtom, activityRailNarrowOverrideAtom } from '@/atoms/unified-shell'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import {
  APP_NAV_DESTINATIONS,
  type AppNavDestination,
} from '../components/app-shell/nav-destinations'
import { focusServicePanelAtom } from '../components/app-shell/service-navigation'
import { CHROME_DENSITY } from './chrome-density'
import { ExtraScreensRailGroup } from '../pages/extra-screens/ExtraScreensRailGroup'
import { RailRow } from './RailRow'
import { routes } from '../../shared/routes'

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

export interface ActivityRailProps {
  /** Reuses the existing native inspector or WebUI browser workflow. */
  onOpenBrowser?: () => void
}

function RailItem({
  dest,
  collapsed,
  onOpenBrowser,
}: {
  dest: AppNavDestination
  collapsed: boolean
  onOpenBrowser?: () => void
}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const focusServicePanel = useSetAtom(focusServicePanelAtom)
  const label = t(dest.labelKey)
  // `route: null` disables a destination only when it has no action to run.
  const disabled = dest.route === null && !dest.action
  return (
    <RailRow
      icon={dest.icon}
      label={label}
      tooltip={disabled && dest.disabledTooltipKey ? t(dest.disabledTooltipKey) : label}
      collapsed={collapsed}
      disabled={disabled}
      active={!disabled && dest.isActive(navState)}
      onClick={() => {
        // Focus an already-open service panel before opening a second copy.
        if (focusServicePanel(dest.id)) return
        if (dest.action === 'open-browser') {
          if (onOpenBrowser) onOpenBrowser()
          else window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))
          return
        }
        if (dest.route) void navigate(dest.route())
      }}
      muted
      testId={`rail-item-${dest.id}`}
    />
  )
}

function RailSection({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}>{children}</div>
  )
}

export function ActivityRail({ onOpenBrowser }: ActivityRailProps = {}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { collapsed, toggle } = useEffectiveRailCollapsed()
  const toggleLabel = collapsed ? t('rail.expand') : t('rail.collapse')

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
        {APP_NAV_DESTINATIONS.map((dest) => (
          <RailItem key={dest.id} dest={dest} collapsed={collapsed} onOpenBrowser={onOpenBrowser} />
        ))}
      </RailSection>
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
