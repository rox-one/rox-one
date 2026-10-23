/**
 * MessengerListSkeleton — SE row placeholders for channel / conversation /
 * thread list load (and messenger sidebar chats). Prefer over spinning
 * indicators when the list shape is known. Streaming chrome and action/busy
 * indicators stay elsewhere.
 */
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@rox/ui'
import { cn } from '@/lib/utils'

export interface MessengerListSkeletonProps {
  /** How many fake channel/conversation rows to paint (clamped ≥ 1). */
  rows?: number
  className?: string
  /** test id for the busy region (default messenger-list-loading). */
  testId?: string
}

export function MessengerListSkeleton({
  rows: rawRows = 6,
  className,
  testId = 'messenger-list-loading',
}: MessengerListSkeletonProps) {
  const { t } = useTranslation()
  const rows = !Number.isFinite(rawRows) ? 6 : Math.max(1, Math.floor(rawRows))
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid={testId}
      className={cn('flex min-h-0 flex-1 flex-col gap-0.5 px-1 py-1 text-muted-foreground', className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5"
          aria-hidden="true"
        >
          <Skeleton circle className="mt-1 size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Skeleton className="h-3 w-[58%]" />
              <Skeleton className="ms-auto h-2.5 w-8 shrink-0" />
            </span>
            <Skeleton className="h-2.5 w-[72%]" />
          </span>
        </div>
      ))}
      <p className="sr-only">{t('common.loading')}</p>
    </div>
  )
}
