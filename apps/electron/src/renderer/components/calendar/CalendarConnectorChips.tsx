import type { CalendarProvider } from '@rox/core/calendar'
import { isCalendarConnectorWired } from '@rox/core/calendar'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders', 'appleCalendar']

/** Honest Google connector state surfaced by `calendar:googleStatus`. */
export type GoogleConnectorStatus = 'unavailable' | 'disconnected' | 'connected'

export interface CalendarConnectorChipsProps {
  className?: string
  /** Google Calendar connector state. Defaults to `unavailable` — never fake availability. */
  googleStatus?: GoogleConnectorStatus
  /** Disables the Google chip while a connect/sync request is in flight. */
  googleBusy?: boolean
  /** Enabled Google chip action when the connector is disconnected. */
  onConnect?: (provider: CalendarProvider) => void
  /** Enabled Google chip action when the connector is connected. */
  onDisconnect?: (provider: CalendarProvider) => void
}

function chipClasses(disabled: boolean, interactive: boolean): string {
  return cn(
    'rounded-full bg-surface-hover px-2 py-0.5',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-pressed',
    interactive && 'underline underline-offset-2',
  )
}

export function CalendarConnectorChips({
  className,
  googleStatus = 'unavailable',
  googleBusy = false,
  onConnect,
  onDisconnect,
}: CalendarConnectorChipsProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="calendar-connector-chips">
      {CALENDAR_PROVIDERS.map((provider) => {
        const label = t(`calendar.provider.${provider}`)
        const isGoogle = provider === 'google'
        const isAppleCalendar = provider === 'appleCalendar'
        // Apple Calendar needs the live EventKit adapter wired AND a connect handler.
        const appleWired = isAppleCalendar && Boolean(onConnect) && isCalendarConnectorWired(provider)
        const disabled = isGoogle
          ? googleStatus === 'unavailable' || googleBusy
          : isAppleCalendar
            ? !appleWired
            : true

        const hint = isGoogle
          ? googleStatus === 'unavailable'
            ? t('calendar.googleUnavailableHint', { provider: label })
            : googleStatus === 'connected'
              ? t('calendar.googleConnectedHint')
              : t('calendar.googleConnectHint')
          : appleWired
            ? t('calendar.appleCalendarConnectHint')
            : t('calendar.connectionUnavailable', { provider: label })

        const onClick = isGoogle && !disabled
          ? () => (googleStatus === 'connected' ? onDisconnect : onConnect)?.(provider)
          : appleWired
            ? () => onConnect?.(provider)
            : undefined

        const chip = (
          <button
            type="button"
            disabled={disabled}
            aria-disabled={disabled}
            aria-label={hint}
            onClick={onClick}
            className={chipClasses(disabled, (isGoogle || isAppleCalendar) && !disabled)}
          >
            {label}
          </button>
        )

        return (
          <Tooltip key={provider}>
            <TooltipTrigger asChild>
              <span>{chip}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {hint}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}