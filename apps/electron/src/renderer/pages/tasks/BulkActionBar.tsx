import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type BulkAction = 'complete' | 'today' | 'evening' | 'someday' | 'move' | 'trash'

interface BulkActionBarProps {
  count: number
  onAction: (action: BulkAction) => void
  onClear: () => void
}

const ACTIONS: { id: BulkAction; label: string; danger?: boolean }[] = [
  { id: 'complete', label: 'tasks.bulk.complete' },
  { id: 'today', label: 'tasks.when.today' },
  { id: 'evening', label: 'tasks.when.evening' },
  { id: 'someday', label: 'tasks.bulk.someday' },
  { id: 'move', label: 'tasks.bulk.move' },
  { id: 'trash', label: 'tasks.bulk.trash', danger: true },
]

/** Floating glass toolbar shown while two or more tasks are selected. */
export function BulkActionBar({ count, onAction, onClear }: BulkActionBarProps) {
  const { t } = useTranslation()
  return (
    <div
      role="toolbar"
      aria-label={t('tasks.bulk.toolbar', { count })}
      data-testid="tasks-bulk-bar"
      className="pointer-events-auto fixed bottom-6 left-1/2 z-chrome flex -translate-x-1/2 items-center gap-1 rounded-[var(--radius-card)] border border-border-subtle bg-background/70 px-2 py-1.5 text-sm shadow-strong backdrop-blur-xl"
    >
      <span className="px-2 font-medium tabular-nums" aria-live="polite" data-testid="tasks-bulk-count">
        {t('tasks.bulk.selected', { count })}
      </span>
      <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          data-testid={`tasks-bulk-${action.id}`}
          onClick={() => onAction(action.id)}
          className={cn(
            'rounded-[var(--radius-control)] px-2 py-1 hover:bg-surface-hover',
            action.danger && 'text-destructive',
          )}
        >
          {t(action.label)}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
      <button type="button" data-testid="tasks-bulk-clear" onClick={onClear} aria-label={t('tasks.bulk.clear')} className="rounded-[var(--radius-control)] px-2 py-1 text-text-muted hover:bg-surface-hover">
        {t('tasks.bulk.clear')}
      </button>
    </div>
  )
}
