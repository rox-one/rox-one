import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface OnboardingErrorProps {
  /** Error copy; nothing renders when empty. */
  message?: string
  /** Retry action rendered as a labelled button (P-10-19). */
  onRetry?: () => void
  /** Optional dismiss action; wires the wizard's onClearError threading. */
  onDismiss?: () => void
  className?: string
}

/**
 * OnboardingError - one shared error region for the onboarding flows.
 *
 * Always exposed as `role="alert"` with a retry affordance, so Git Bash and
 * credential failures recover in the same way (P-10-19).
 */
export function OnboardingError({ message, onRetry, onDismiss, className }: OnboardingErrorProps) {
  const { t } = useTranslation()
  if (!message) return null

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive',
        className,
      )}
    >
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry || onDismiss ? (
        <div className="flex shrink-0 items-center gap-1">
          {onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onRetry}
            >
              {t('onboarding.retry')}
            </Button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onDismiss}
              className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
            >
              <X className="icon-toolbar" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}