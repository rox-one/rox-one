/**
 * «Ещё» group in the ActivityRail: the extra workbench screens whose
 * `workbench.mode.<id>.v1` flag is on. Separated from the main destinations
 * by a tone gap (no line); same 32×32 buttons and tooltips as RailItem.
 */
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { routes } from '../../../shared/routes'
import { visibleExtraScreens } from './registry'

export function ExtraScreensRailGroup() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const screens = visibleExtraScreens(useAtomValue(enabledExtraScreenIdsAtom))
  if (screens.length === 0) return null
  return (
    <div className="mt-3 flex flex-col items-center gap-0.5" role="group" aria-label={t('extraScreens.more')} data-testid="rail-extra-screens">
      <div aria-hidden className="pb-0.5 text-[9px] uppercase tracking-[0.04em] text-muted-foreground/80">{t('extraScreens.more')}</div>
      {screens.map((screen) => {
        const Icon = screen.icon
        const label = t(screen.labelKey)
        const active = navState.navigator === 'screen' && navState.screen === screen.id
        return (
          <Tooltip key={screen.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => void navigate(routes.view.screen(screen.id))}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors',
                  active ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
