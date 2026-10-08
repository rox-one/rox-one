import { cn } from '@/lib/utils'

const WELCOME_STEP_COUNT = 4

/** First-run progress bars only — no SE / harness copy. */
export function OnboardingWelcomeProgress({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex gap-2', className)}
      role="progressbar"
      aria-valuenow={1}
      aria-valuemin={1}
      aria-valuemax={WELCOME_STEP_COUNT}
      data-testid="onboarding-welcome-progress"
    >
      {Array.from({ length: WELCOME_STEP_COUNT }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1 flex-1 rounded-full',
            i === 0 ? 'bg-background shadow-minimal' : 'bg-foreground/10',
          )}
          aria-hidden
        />
      ))}
    </div>
  )
}
