import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
    <div className="rounded-[var(--radius-control)] bg-[var(--state-hover)] py-1.5 pl-2.5 pr-1" data-promo-slot={kind} title={body}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">{title}</div>
        {onDismiss ? <button type="button" onClick={onDismiss} aria-label={t('common.dismiss')} title={t('common.dismiss')} className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-[var(--state-pressed)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"><X className="icon-status" aria-hidden /></button> : null}
      </div>
      <span className="sr-only">{body}</span>
      <button
        type="button"
        className="mt-0.5 text-caption text-accent hover:underline focus-visible:underline focus-visible:outline-none"
        onClick={onCta}
      >
        {cta} →
      </button>
    </div>
  )
}
