import type { CalendarProvider } from '@rox/core/calendar'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders', 'appleCalendar']

/** Honest Google connector state surfaced by `calendar:googleStatus`. */
export type GoogleConnectorStatus = 'unavailable' | 'disconnected' | 'connected'

/**
 * Apple Calendar connector state surfaced by `calendar:appleStatus`.
 *
 * `denied` is distinct from `disconnected`: macOS refused EventKit access, so
 * the chip stays disabled until the user changes it in System Settings.
 */
export type AppleConnectorStatus = 'unavailable' | 'disconnected' | 'denied' | 'connected'

export interface CalendarConnectorChipsProps {
  className?: string
  /** Google Calendar connector state. Defaults to `unavailable` — never fake availability. */
  googleStatus?: GoogleConnectorStatus
  /** Disables the Google chip while a connect/sync request is in flight. */
  googleBusy?: boolean
  /** Apple Calendar connector state. Defaults to `unavailable` — never fake availability. */
  appleStatus?: AppleConnectorStatus
  /** Disables the Apple chip while a connect/sync request is in flight. */
  appleBusy?: boolean
  /** Enabled chip action when a connector is disconnected. */
  onConnect?: (provider: CalendarProvider) => void
  /** Enabled chip action when a connector is connected. */
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
  appleStatus = 'unavailable',
  appleBusy = false,
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

        let hint: string
        let disabled = true
        if (isGoogle) {
          disabled = googleStatus === 'unavailable' || googleBusy
          hint = googleStatus === 'unavailable'
            ? t('calendar.googleUnavailableHint', { provider: label })
            : googleStatus === 'connected'
              ? t('calendar.googleConnectedHint')
              : t('calendar.googleConnectHint')
        } else if (isAppleCalendar) {
          disabled = appleStatus === 'unavailable' || appleStatus === 'denied' || appleBusy
          hint = appleStatus === 'unavailable'
            ? t('calendar.appleCalendarUnavailableHint', { provider: label })
            : appleStatus === 'denied'
              ? t('calendar.appleCalendarDeniedHint')
              : appleStatus === 'connected'
                ? t('calendar.appleCalendarConnectedHint')
                : t('calendar.appleCalendarConnectHint')
        } else {
          hint = t('calendar.connectionUnavailable', { provider: label })
        }

        let onClick: (() => void) | undefined
        if (isGoogle && !disabled) {
          onClick = () => (googleStatus === 'connected' ? onDisconnect : onConnect)?.(provider)
        } else if (isAppleCalendar && !disabled) {
          onClick = () => (appleStatus === 'connected' ? onDisconnect : onConnect)?.(provider)
        }

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