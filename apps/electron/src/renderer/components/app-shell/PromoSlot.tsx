import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PromoKind } from '@/platform/promo-slot'

interface PromoSlotProps {
  kind: PromoKind
  reminderDueCount?: number
  onCta: () => void
}

export function PromoSlot({ kind, reminderDueCount, onCta }: PromoSlotProps) {
  const { t } = useTranslation()
  const title =
    kind === 'onboarding' ? t('promo.onboardingTitle') : t('promo.reminderTitle')
  const body =
    kind === 'onboarding'
      ? t('promo.onboardingBody')
      : t('promo.reminderBody', { count: reminderDueCount ?? 0 })
  const cta = kind === 'onboarding' ? t('promo.onboardingCta') : t('promo.reminderCta')

  return (
    <div className="rox-card px-2 py-2" data-promo-slot={kind}>
      <div className="text-[12px] font-medium text-foreground">{title}</div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{body}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 h-7 w-full text-[11px]"
        onClick={onCta}
      >
        {cta}
      </Button>
    </div>
  )
}
