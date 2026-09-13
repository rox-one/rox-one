import { isCalendarConnectorWired, type CalendarProvider } from '@craft-agent/core/calendar'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']

export function CalendarConnectorChips({
  onConnect,
  className,
}: {
  onConnect?: (provider: CalendarProvider) => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="calendar-connector-chips">
      {CALENDAR_PROVIDERS.map((provider) => {
        const wired = isCalendarConnectorWired(provider)
        const label = t(`calendar.provider.${provider}`)
        const chip = (
          <button
            key={provider}
            type="button"
            disabled={!wired}
            className={cn(
              'rounded-full border border-foreground/10 px-2 py-0.5',
              !wired && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => {
              if (wired) onConnect?.(provider)
            }}
          >
            {label}
          </button>
        )
        if (wired) return chip
        return (
          <Tooltip key={provider}>
            <TooltipTrigger asChild>
              <span>{chip}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {t('calendar.connectorUnavailable', { provider: label })}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
