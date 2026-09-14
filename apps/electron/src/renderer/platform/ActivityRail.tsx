/**
 * ActivityRail (W1 unified shell, spec S-03 §3.1/§3.2) — compact vertical icon
 * rail for top-level navigation (design-compact density).
 *
 * The destinations list mirrors AppShell's `links[]` via the shared
 * `APP_NAV_DESTINATIONS` config (no divergent copy); navigation goes through
 * NavigationContext's `navigate()` (the URL stays the source of truth).
 * Wave-gated destinations (`route: null`) render disabled-with-tooltip;
 * Knowledge navigates since W2 (flag-off state lives in the surface).
 *
 * Collapse state persists via `activityRailCollapsedAtom` (KEYS.activityRailCollapsed).
 * Collapsed = destinations hidden, only the expand chevron stays (atom contract).
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled, so there is no flag check here.
 */
import { useAtom } from 'jotai'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { activityRailCollapsedAtom } from '@/atoms/unified-shell'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import {
  APP_NAV_DESTINATIONS,
  type AppNavDestination,
} from '../components/app-shell/nav-destinations'
import { CHROME_DENSITY } from './chrome-density'

/** Expanded rail width — AppShell uses it to offset the absolute resize sashes. */
export const ACTIVITY_RAIL_WIDTH = CHROME_DENSITY.railWidth
/** Collapsed rail keeps a usable hit target so the expand chevron stays clickable. */
export const ACTIVITY_RAIL_COLLAPSED_WIDTH = CHROME_DENSITY.railWidth

function RailItem({ dest }: { dest: AppNavDestination }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const Icon = dest.icon
  const label = t(dest.labelKey)
  const disabled = dest.route === null

  const button = (
    <button
      type="button"
      data-testid={`${dest.id}-nav`}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : () => void navigate(dest.route!())}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/40'
          : dest.isActive(navState)
            ? 'bg-accent/10 text-accent'
            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        {disabled && dest.disabledTooltipKey ? t(dest.disabledTooltipKey) : label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ActivityRail() {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useAtom(activityRailCollapsedAtom)

  if (collapsed) {
    return (
      <nav
        aria-label={t('rail.title')}
        className="chrome-rail flex h-full shrink-0 flex-col items-center py-1.5"
        style={{ width: ACTIVITY_RAIL_COLLAPSED_WIDTH }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('rail.expand')}
              onClick={() => setCollapsed(false)}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('rail.expand')}</TooltipContent>
        </Tooltip>
      </nav>
    )
  }

  return (
    <nav
      aria-label={t('rail.title')}
      className="chrome-rail flex h-full shrink-0 flex-col items-center py-1.5"
      style={{ width: ACTIVITY_RAIL_WIDTH }}
    >
      <div className="flex flex-col items-center gap-0.5">
        {APP_NAV_DESTINATIONS.map((dest) => (
          <RailItem key={dest.id} dest={dest} />
        ))}
      </div>
      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('rail.collapse')}
              onClick={() => setCollapsed(true)}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-muted-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('rail.collapse')}</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
