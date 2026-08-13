/**
 * Mode Bar — compact current-mode control in the TopBar. Reads the same
 * ModeRegistry as ActivityRail (no second catalog).
 */

import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { getWorkbenchModeRegistry } from './modes-bootstrap'
import { coreModeIsActive } from './mode-rail-model'
import { modeIcon } from './mode-icons'
import { TopBarButton } from '../components/ui/TopBarButton'
import type { ViewRoute } from '../../shared/routes'

export function ModeBar() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const modes = getWorkbenchModeRegistry().list({})
  const active = modes.find((mode) => coreModeIsActive(mode.id, navState)) ?? modes[0]
  if (!active) return null

  const ActiveIcon = modeIcon(active.icon)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <TopBarButton aria-label={t('modeBar.switchMode')} className="titlebar-no-drag gap-1.5 px-2">
              <ActiveIcon className="h-3.5 w-3.5 text-foreground/70" />
              <span className="max-w-[9rem] truncate text-[12px] text-foreground/80">
                {t(active.title)}
              </span>
            </TopBarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('modeBar.title')}</TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent align="start" minWidth="min-w-44">
        {modes.map((mode) => {
          const Icon = modeIcon(mode.icon)
          const selected = coreModeIsActive(mode.id, navState)
          return (
            <StyledDropdownMenuItem
              key={mode.id}
              onSelect={() => void navigate(mode.rootRoute as ViewRoute)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className={selected ? 'font-medium' : undefined}>{t(mode.title)}</span>
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
