import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type SeOnboardingStepId = 'welcome' | 'harness' | 'sidebar' | 'workspace'

export interface SuperEngineeringOnboardingProps {
  step: SeOnboardingStepId
  className?: string
}

const STEP_ORDER: SeOnboardingStepId[] = ['welcome', 'harness', 'sidebar', 'workspace']

export function SuperEngineeringOnboarding({ step, className }: SuperEngineeringOnboardingProps) {
  const { t } = useTranslation()
  const index = STEP_ORDER.indexOf(step)
  return (
    <div className={cn('space-y-4', className)} data-testid={`se-onboarding-${step}`}>
      <div className="flex gap-2">
        {STEP_ORDER.map((id, i) => (
          <div
            key={id}
            className={cn(
              'h-1 flex-1 rounded-full',
              i <= index ? 'bg-accent' : 'bg-foreground/10',
            )}
            aria-hidden
          />
        ))}
      </div>
      <h2 className="text-lg font-semibold">{t(`se.onboarding.${step}.title`)}</h2>
      <p className="text-sm text-muted-foreground">{t(`se.onboarding.${step}.body`)}</p>
    </div>
  )
}
