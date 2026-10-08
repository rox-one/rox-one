import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type SeOnboardingStepId = 'welcome' | 'harness' | 'sidebar' | 'workspace'

export interface SuperEngineeringOnboardingProps {
  step: SeOnboardingStepId
  /** When false, only the step progress bars are shown (no title/body). */
  showHeader?: boolean
  className?: string
}

const STEP_ORDER: SeOnboardingStepId[] = ['welcome', 'harness', 'sidebar', 'workspace']

export function SuperEngineeringOnboarding({
  step,
  showHeader = true,
  className,
}: SuperEngineeringOnboardingProps) {
  const { t } = useTranslation()
  const index = STEP_ORDER.indexOf(step)
  return (
    <div className={cn('space-y-4', className)} data-testid={`se-onboarding-${step}`}>
      <div className="flex gap-2" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={STEP_ORDER.length}>
        {STEP_ORDER.map((id, i) => (
          <div
            key={id}
            className={cn(
              'h-1 flex-1 rounded-full',
              i <= index
                ? 'bg-background shadow-minimal'
                : 'bg-foreground/10',
            )}
            aria-hidden
          />
        ))}
      </div>
      {showHeader ? (
        <>
          <h2 className="text-lg font-semibold">{t(`se.onboarding.${step}.title`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`se.onboarding.${step}.body`)}</p>
        </>
      ) : null}
    </div>
  )
}
