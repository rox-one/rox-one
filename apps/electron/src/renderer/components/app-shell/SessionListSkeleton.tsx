/**
 * SessionListSkeleton — SE row placeholders for navigator session-list
 * initial / content-search load. Prefer over spinning indicators when the list shape
 * is known. Live SessionItem isProcessing indicators stay elsewhere.
 */
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@rox/ui'
import { cn } from '@/lib/utils'

export interface SessionListSkeletonProps {
  /** How many fake session rows to paint (clamped ≥ 1). */
  rows?: number
  className?: string
}

export function SessionListSkeleton({ rows: rawRows = 6, className }: SessionListSkeletonProps) {
  const { t } = useTranslation()
  const rows = !Number.isFinite(rawRows) ? 6 : Math.max(1, Math.floor(rawRows))
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid="session-list-loading"
      className={cn('flex min-h-0 flex-1 flex-col gap-0 px-1 py-1 text-muted-foreground', className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex min-h-[var(--control-lg)] items-center gap-2 border-t border-border-subtle/40 px-2 py-2 first:border-t-0"
          aria-hidden="true"
        >
          <Skeleton circle className="size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-[68%]" />
            <Skeleton className="h-2.5 w-[42%]" />
          </span>
          <Skeleton className="h-2.5 w-8 shrink-0" />
        </div>
      ))}
      <p className="sr-only">{t('common.loading')}</p>
    </div>
  )
}
