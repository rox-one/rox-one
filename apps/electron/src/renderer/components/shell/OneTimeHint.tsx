/** Dismiss-once contextual hint (top-50 #43). Renders nothing once dismissed. */
import { useTranslation } from 'react-i18next'
import { Lightbulb, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dismissHint, useHintVisible } from '@/lib/one-time-hints'

export interface OneTimeHintProps {
  id: string
  title: string
  body: string
  /** Extra condition (e.g. only when the strip has 2+ panels). */
  when?: boolean
  className?: string
}

export function OneTimeHint({ id, title, body, when = true, className }: OneTimeHintProps) {
  const { t } = useTranslation()
  const visible = useHintVisible(id, when)
  if (!visible) return null
  return (
    <aside
      role="note"
      aria-label={title}
      data-one-time-hint={id}
      className={cn('flex max-w-sm items-start gap-2 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated p-3 text-small shadow-middle', className)}
    >
      <Lightbulb className="icon-inline mt-0.5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-text-secondary">{body}</p>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          className="mt-2 rounded-[var(--radius-control)] px-1.5 py-0.5 text-caption font-medium text-accent hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t('shell.hint.gotIt')}
        </button>
      </div>
      <button
        type="button"
        onClick={() => dismissHint(id)}
        aria-label={t('shell.hint.dismiss')}
        className="shrink-0 rounded-[var(--radius-control)] p-0.5 text-text-muted hover:bg-surface-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="icon-caption" aria-hidden />
      </button>
    </aside>
  )
}
