/**
 * «Ещё» group in the ActivityRail: the extra workbench screens whose
 * `workbench.mode.<id>.v1` flag is on. Separated from the main destinations
 * by a tone gap (no line); rows are the shared `RailRow` (icon + label when
 * the rail is expanded, icon + tooltip when collapsed). The group header is
 * a visible label when expanded and a tiny caption when collapsed.
 */
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { routes } from '../../../shared/routes'
import { RailRow } from '../../platform/RailRow'
import { visibleExtraScreens } from './registry'

export function ExtraScreensRailGroup({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const screens = visibleExtraScreens(useAtomValue(enabledExtraScreenIdsAtom))
  if (screens.length === 0) return null
  const header = t('extraScreens.more')
  return (
    <div
      className={cn('mt-[12px] flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}
      role="group"
      aria-label={header}
      data-testid="rail-extra-screens"
    >
      <div
        aria-hidden
        className={cn(
          'uppercase text-muted-foreground',
          collapsed
            ? 'pb-[2px] text-[9px] tracking-[0.04em]'
            : 'flex h-[24px] items-end px-[8px] pb-[4px] text-[11px] font-medium tracking-[0.06em]',
        )}
      >
        {header}
      </div>
      {screens.map((screen) => (
        <RailRow
          key={screen.id}
          icon={screen.icon}
          label={t(screen.labelKey)}
          collapsed={collapsed}
          active={navState.navigator === 'screen' && navState.screen === screen.id}
          onClick={() => void navigate(routes.view.screen(screen.id))}
          testId={`rail-screen-${screen.id}`}
        />
      ))}
    </div>
  )
}
