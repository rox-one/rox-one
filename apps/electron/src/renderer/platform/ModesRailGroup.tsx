/**
 * W1-07 (#1504, owner decision) — registered modes in the left ActivityRail.
 *
 * Every navigable mode beyond the baseline seven (unified Messenger /
 * Calendar / Goals / Contacts, wave-2 `registerSeededMode`) continues the rail
 * after the destinations, in the titlebar pill / ⌘1…7 order. With every mode
 * flag off `railModeEntries` is empty and this renders nothing, so the rail is
 * exactly `APP_NAV_DESTINATIONS` as on main.
 */
import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import type { Route } from '../../shared/routes'
import { preloadRoute } from '../components/app-shell/route-pages'
import type { RoutePageName } from '../components/app-shell/route-pages'
import { RailRow } from './RailRow'
import { resolveLucideIcon } from './lucide-icon'
import { isModeActive } from './mode-registry-bootstrap'
import { railModeEntries } from './surface-shell'
import { useShellModes } from './useModes'

/**
 * PERF-10 (#1577) — hover/focus prefetch table: every row here navigates to
 * `routes.view.surface(<mode id>)`, which the dispatcher renders through
 * `SurfaceHost` (`ROUTE_PAGE_LOADERS.surfaces`). A mode registered with any
 * other root route simply gets no entry (no prefetch) rather than a wrong one.
 */
const MODE_GROUP_ROUTE_PRELOADS: Record<string, RoutePageName> = {
  messenger: 'surfaces',
  calendar: 'surfaces',
  goals: 'surfaces',
  contacts: 'surfaces',
}

export function ModesRailGroup({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const entries = railModeEntries(useShellModes().modes)
  if (entries.length === 0) return null
  return (
    <div
      className={cn('mt-[12px] flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}
      role="group"
      aria-label={t('workbench.modes')}
      data-testid="rail-modes"
    >
      {entries.map((mode) => {
        // PERF-10 (#1577): preload the surface chunk once the pointer/focus
        // enters the row. The preloader memoizes, so repeat events are free and
        // a failed chunk stays retryable; the route error boundary owns the
        // user-visible failure. `display: contents` keeps the wrapper out of
        // the box tree, so the row keeps its layout.
        const preload = MODE_GROUP_ROUTE_PRELOADS[mode.id]
        const prefetchOnIntent = () => {
          if (!preload) return
          void preloadRoute(preload).catch(() => {})
        }
        return (
          <div key={mode.id} className="contents" onPointerEnter={prefetchOnIntent} onFocus={prefetchOnIntent}>
            <RailRow
              icon={resolveLucideIcon(mode.icon) ?? LayoutGrid}
              label={t(mode.titleKey)}
              collapsed={collapsed}
              active={isModeActive(mode.id, navState)}
              onClick={() => void navigate(mode.rootRoute as Route)}
              muted
              testId={`rail-mode-${mode.id}`}
            />
          </div>
        )
      })}
    </div>
  )
}
