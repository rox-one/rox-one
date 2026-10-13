import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type OnboardingProgressStep = 'profile' | 'connect' | 'done'

const STEPS: { id: OnboardingProgressStep; labelKey: string }[] = [
  { id: 'profile', labelKey: 'onboarding.steps.profile' },
  { id: 'connect', labelKey: 'onboarding.steps.connect' },
  { id: 'done', labelKey: 'onboarding.steps.done' },
]

interface OnboardingStepProgressProps {
  /** Current stage of the wizard. */
  step: OnboardingProgressStep
  className?: string
}

/**
 * OnboardingStepProgress - compact 3-step rail (Профиль → Подключение → Готово)
 *
 * Shared by every profile: rendered above the step body by the wizard so the
 * default profile always knows how many steps follow (P-10-17).
 */
export function OnboardingStepProgress({ step, className }: OnboardingStepProgressProps) {
  const { t } = useTranslation()
  const index = Math.max(0, STEPS.findIndex((s) => s.id === step))
  const current = STEPS[index] ?? STEPS[0]!

  return (
    <ol
      className={cn('flex gap-2', className)}
      role="progressbar"
      aria-valuenow={index + 1}
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuetext={t(current.labelKey)}
      data-onboarding-progress
      data-step={step}
    >
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          className="flex min-w-0 flex-1 flex-col gap-1.5"
          aria-current={i === index ? 'step' : undefined}
        >
          <span
            className={cn(
              'h-1 w-full rounded-full',
              i <= index ? 'bg-background shadow-minimal' : 'bg-surface-pressed',
            )}
            aria-hidden
          />
          <span
            className={cn(
              'truncate text-xs',
              i <= index ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {t(s.labelKey)}
          </span>
        </li>
      ))}
    </ol>
  )
}