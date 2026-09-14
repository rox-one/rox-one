/**
 * Compact service navigation. Primary services stay in a stable order; every
 * supporting service remains reachable through More. Selecting an open service
 * focuses its existing panel instead of replacing a route or remounting content.
 */
import { useAtom, useSetAtom } from 'jotai'
import { Check, ChevronsLeft, ChevronsRight, Grid2X2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { activityRailCollapsedAtom } from '@/atoms/unified-shell'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import {
  APP_NAV_DESTINATIONS,
  type AppNavDestination,
  type AppNavDestinationId,
} from '../components/app-shell/nav-destinations'
import { focusServicePanelAtom, getActiveService } from '../components/app-shell/service-navigation'
import { CHROME_DENSITY } from './chrome-density'

/** Shared with AppShell's resize offsets. Collapse retains a usable expand target. */
export const ACTIVITY_RAIL_WIDTH = CHROME_DENSITY.railWidth
export const ACTIVITY_RAIL_COLLAPSED_WIDTH = CHROME_DENSITY.railWidth

const primaryServices = APP_NAV_DESTINATIONS.filter((destination) => destination.railGroup === 'primary')
const moreServices = APP_NAV_DESTINATIONS.filter((destination) => destination.railGroup === 'more')
const footerServices = APP_NAV_DESTINATIONS.filter((destination) => destination.railGroup === 'footer')

const railButtonClassName = cn(
  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] outline-none',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
)

export interface ActivityRailProps {
  /** Reuses the existing native inspector or WebUI browser workflow. */
  onOpenBrowser?: () => void
  /** A browser inspector can supply its own active service without changing routes. */
  activeServiceId?: AppNavDestinationId | null
}

function RailItem({
  destination,
  active,
  onActivate,
}: {
  destination: AppNavDestination
  active: boolean
  onActivate: (destination: AppNavDestination) => void
}) {
  const { t } = useTranslation()
  const Icon = destination.icon
  const label = t(destination.railLabelKey ?? destination.labelKey)
  const disabled = destination.route === null && !destination.action

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          aria-disabled={disabled || undefined}
          data-service-id={destination.id}
          onClick={disabled ? undefined : () => onActivate(destination)}
          className={cn(
            railButtonClassName,
            disabled
              ? 'cursor-not-allowed text-muted-foreground/40'
              : active
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
        >
          {active && <span className="absolute -left-1 h-4 w-0.5 rounded-full bg-current" aria-hidden />}
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        {disabled && destination.disabledTooltipKey ? t(destination.disabledTooltipKey) : label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ActivityRail({ onOpenBrowser, activeServiceId }: ActivityRailProps = {}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const focusServicePanel = useSetAtom(focusServicePanelAtom)
  const [collapsed, setCollapsed] = useAtom(activityRailCollapsedAtom)
  const activeId = activeServiceId === undefined ? getActiveService(navState) : activeServiceId
  const moreActive = moreServices.some((destination) => destination.id === activeId)

  const activateService = (destination: AppNavDestination) => {
    if (focusServicePanel(destination.id)) return
    if (destination.action === 'open-browser') {
      if (onOpenBrowser) onOpenBrowser()
      else window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))
      return
    }
    if (destination.route) void navigate(destination.route())
  }

  return (
    <nav
      aria-label={t('serviceRail.title')}
      data-service-rail="true"
      className="chrome-rail flex h-full shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden border-r border-border/40 py-2"
      style={{ width: collapsed ? ACTIVITY_RAIL_COLLAPSED_WIDTH : ACTIVITY_RAIL_WIDTH }}
    >
      {!collapsed && (
        <div className="flex flex-col items-center gap-1">
          {primaryServices.map((destination) => (
            <RailItem
              key={destination.id}
              destination={destination}
              active={destination.id === activeId}
              onActivate={activateService}
            />
          ))}
          <div className="my-1 h-px w-5 bg-border/60" aria-hidden />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('serviceRail.more')}
                    data-service-id="more"
                    className={cn(
                      railButtonClassName,
                      moreActive
                        ? 'bg-accent/10 text-accent'
                        : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                    )}
                  >
                    {moreActive && <span className="absolute -left-1 h-4 w-0.5 rounded-full bg-current" aria-hidden />}
                    <Grid2X2 className="h-4 w-4" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{t('serviceRail.more')}</TooltipContent>
            </Tooltip>
            <StyledDropdownMenuContent side="right" align="start" minWidth="min-w-48">
              {moreServices.map((destination) => {
                const Icon = destination.icon
                const active = destination.id === activeId
                return (
                  <StyledDropdownMenuItem
                    key={destination.id}
                    data-service-id={destination.id}
                    aria-current={active ? 'page' : undefined}
                    onSelect={() => activateService(destination)}
                    className="min-h-7 [@media(pointer:coarse)]:min-h-11"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="flex-1">{t(destination.railLabelKey ?? destination.labelKey)}</span>
                    {active && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className={cn('flex flex-col items-center gap-1', !collapsed && 'mt-auto pt-2')}>
        {!collapsed && footerServices.map((destination) => (
          <RailItem
            key={destination.id}
            destination={destination}
            active={destination.id === activeId}
            onActivate={activateService}
          />
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t(collapsed ? 'rail.expand' : 'rail.collapse')}
              onClick={() => setCollapsed(!collapsed)}
              className={cn(railButtonClassName, 'text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground')}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t(collapsed ? 'rail.expand' : 'rail.collapse')}</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
