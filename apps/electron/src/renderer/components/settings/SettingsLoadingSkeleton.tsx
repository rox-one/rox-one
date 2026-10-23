/**
 * SettingsLoadingSkeleton — SE placeholder for settings page/panel initial load.
 * Prefer this over spinning indicators when the final layout shape is known.
 * Skeleton shimmer is transform-only and stops under prefers-reduced-motion /
 * data-resizing (see packages/ui Skeleton). Parent owns aria-busy via this wrapper.
 */
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@rox/ui'
import { cn } from '@/lib/utils'

export interface SettingsLoadingSkeletonProps {
  /** `panel` fills remaining height under a PanelHeader; `section` sits in scroll content. */
  variant?: 'panel' | 'section'
  className?: string
}

export function SettingsLoadingSkeleton({
  variant = 'section',
  className,
}: SettingsLoadingSkeletonProps) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid="settings-loading-skeleton"
      className={cn(
        'flex w-full flex-col text-muted-foreground',
        variant === 'panel'
          ? 'h-full flex-1 items-center justify-center px-8'
          : 'items-stretch justify-center py-12',
        className,
      )}
    >
      <div className="w-full max-w-md space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton lines={4} className="w-full" />
        <p className="sr-only">{t('common.loading')}</p>
      </div>
    </div>
  )
}
