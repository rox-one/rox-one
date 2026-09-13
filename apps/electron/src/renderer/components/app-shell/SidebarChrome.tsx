import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'

interface SidebarChromeProps {
  profile: ProfileStripData
  onProfileClick: () => void
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
}

export function SidebarChrome({
  profile,
  onProfileClick,
  promoKind,
  reminderDueCount,
  onPromoCta,
}: SidebarChromeProps) {
  return (
    <div className="shrink-0 space-y-2 border-t border-border/40 px-1.5 py-2">
      {promoKind ? (
        <PromoSlot kind={promoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} />
      ) : null}
      <ProfileStrip data={profile} onClick={onProfileClick} className="rox-card px-2" />
    </div>
  )
}
