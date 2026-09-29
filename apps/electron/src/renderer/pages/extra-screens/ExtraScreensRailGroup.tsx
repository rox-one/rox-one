/**
 * Extra workbench screens in the ActivityRail (flag `workbench.mode.<id>.v1`).
 * They simply continue the list after a 12px spacing gap: no visible header,
 * no divider (Mark). The group keeps an accessible name («Ещё») for screen
 * readers only. Rows are the shared `RailRow`.
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
  return (
    <div
      className={cn('mt-[12px] flex flex-col gap-[4px]', collapsed ? 'items-center' : 'items-stretch')}
      role="group"
      aria-label={t('extraScreens.more')}
      data-testid="rail-extra-screens"
    >
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
