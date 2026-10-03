import type { CalendarProvider } from '@rox/core/calendar'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']

export function CalendarConnectorChips({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="calendar-connector-chips">
      {CALENDAR_PROVIDERS.map((provider) => {
        const label = t(`calendar.provider.${provider}`)
        const chip = (
          <button
            type="button"
            disabled
            className={cn(
              'rounded-full bg-foreground/[0.05] px-2 py-0.5',
              'cursor-not-allowed opacity-50',
            )}
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
              {t('calendar.connectionUnavailable', { provider: label })}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
