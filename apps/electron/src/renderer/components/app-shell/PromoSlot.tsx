import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PromoKind } from '@/platform/promo-slot'

interface PromoSlotProps {
  kind: PromoKind
  reminderDueCount?: number
  onCta: () => void
  onDismiss?: () => void
}

export function PromoSlot({ kind, reminderDueCount, onCta, onDismiss }: PromoSlotProps) {
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
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[12px] font-medium text-foreground">{title}</div>
        {onDismiss ? <button type="button" onClick={onDismiss} aria-label={t('common.dismiss')} title={t('common.dismiss')} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring"><X className="size-3.5" aria-hidden /></button> : null}
      </div>
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
