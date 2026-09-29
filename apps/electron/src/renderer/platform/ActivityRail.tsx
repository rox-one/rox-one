/**
 * ActivityRail (W1 unified shell, spec S-03 §3.1/§3.2) — vertical navigation
 * rail for top-level destinations (design-compact density).
 *
 * The destinations list mirrors AppShell's `links[]` via the shared
 * `APP_NAV_DESTINATIONS` config (no divergent copy); navigation goes through
 * NavigationContext's `navigate()` (the URL stays the source of truth).
 * Wave-gated destinations (`route: null`) render disabled-with-tooltip;
 * Knowledge navigates since W2 (flag-off state lives in the surface).
 *
 * Two states, persisted via `activityRailCollapsedAtom`
 * (KEYS.activityRailCollapsedV2):
 * - expanded (default): icon + text label on every row, «Ещё» group header
 *   visible — flat 28px rows on the 4px grid, no borders.
 * - collapsed: icons only, each row keeps a right-side tooltip.
 * The toggle («/») sits at the bottom in both states.
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled, so there is no flag check here.
 */
import type { ReactNode } from 'react'
import { useAtom } from 'jotai'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activityRailCollapsedAtom } from '@/atoms/unified-shell'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import {
  APP_NAV_DESTINATIONS,
  type AppNavDestination,
} from '../components/app-shell/nav-destinations'
import { CHROME_DENSITY } from './chrome-density'
import { ExtraScreensRailGroup } from '../pages/extra-screens/ExtraScreensRailGroup'
import { RailRow } from './RailRow'

export { RailRow } from './RailRow'

/** Expanded rail width (icon + label) — AppShell offsets the resize sashes by it. */
export const ACTIVITY_RAIL_WIDTH = CHROME_DENSITY.railExpandedWidth
/** Collapsed rail = icons only (same width as the inspector section rail). */
export const ACTIVITY_RAIL_COLLAPSED_WIDTH = CHROME_DENSITY.railWidth

export function activityRailWidth(collapsed: boolean): number {
  return collapsed ? ACTIVITY_RAIL_COLLAPSED_WIDTH : ACTIVITY_RAIL_WIDTH
}

function RailItem({ dest, collapsed }: { dest: AppNavDestination; collapsed: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const label = t(dest.labelKey)
  const disabled = dest.route === null
  return (
    <RailRow
      icon={dest.icon}
      label={label}
      tooltip={disabled && dest.disabledTooltipKey ? t(dest.disabledTooltipKey) : label}
      collapsed={collapsed}
      disabled={disabled}
      active={!disabled && dest.isActive(navState)}
      onClick={() => void navigate(dest.route!())}
      testId={`rail-item-${dest.id}`}
    />
  )
}

function RailSection({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-0.5', collapsed ? 'items-center' : 'items-stretch')}>{children}</div>
  )
}

export function ActivityRail() {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useAtom(activityRailCollapsedAtom)
  const toggleLabel = collapsed ? t('rail.expand') : t('rail.collapse')

  return (
    <nav
      aria-label={t('rail.title')}
      className={cn(
        'chrome-rail rox-shell-pane rox-shell-divider-r flex h-full shrink-0 flex-col overflow-y-auto overflow-x-hidden py-1.5 font-sans',
        collapsed ? 'items-center' : 'items-stretch px-2',
      )}
      style={{ width: activityRailWidth(collapsed) }}
      data-shell-role="activity-rail"
      data-rail-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <RailSection collapsed={collapsed}>
        {APP_NAV_DESTINATIONS.map((dest) => (
          <RailItem key={dest.id} dest={dest} collapsed={collapsed} />
        ))}
      </RailSection>
      <ExtraScreensRailGroup collapsed={collapsed} />
      <div className={cn('mt-auto pt-2', collapsed ? '' : 'flex')}>
        <RailRow
          icon={collapsed ? ChevronsRight : ChevronsLeft}
          label={toggleLabel}
          collapsed
          muted
          onClick={() => setCollapsed(!collapsed)}
          testId="rail-toggle"
        />
      </div>
    </nav>
  )
}
