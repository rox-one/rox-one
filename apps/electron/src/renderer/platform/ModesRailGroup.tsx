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
import { RailRow } from './RailRow'
import { resolveLucideIcon } from './lucide-icon'
import { isModeActive } from './mode-registry-bootstrap'
import { railModeEntries } from './surface-shell'
import { useShellModes } from './useModes'

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
      {entries.map((mode) => (
        <RailRow
          key={mode.id}
          icon={resolveLucideIcon(mode.icon) ?? LayoutGrid}
          label={t(mode.titleKey)}
          collapsed={collapsed}
          active={isModeActive(mode.id, navState)}
          onClick={() => void navigate(mode.rootRoute as Route)}
          muted
          testId={`rail-mode-${mode.id}`}
        />
      ))}
    </div>
  )
}
