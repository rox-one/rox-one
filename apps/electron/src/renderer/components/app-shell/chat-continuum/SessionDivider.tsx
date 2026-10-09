/**
 * Session divider: a hairline rule with a centred session label and clock.
 * Ported from the G5 kit (`G5SessionDivider`).
 */
import { useTranslation } from 'react-i18next'

export function SessionDivider({ label, time }: { label?: string; time: string }) {
  const { t } = useTranslation()
  return (
    <div data-g05-divider className="relative my-6 flex items-center gap-3">
      <span aria-hidden className="h-px flex-1 bg-border-subtle" />
      <span className="text-caption text-text-secondary">
        {label ?? t('chat.continuum.sessionDivider', { defaultValue: 'Сессия' })}
        <span aria-hidden className="px-1.5">
          ·
        </span>
        <span className="tabular-nums">{time}</span>
      </span>
      <span aria-hidden className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}