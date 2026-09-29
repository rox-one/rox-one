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
    <div className="rox-shell-divider-t shrink-0 space-y-2 px-1.5 py-2">
      {promoKind ? (
        <PromoSlot kind={promoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} />
      ) : null}
      {/* Flat account row: no outline/shadow card, subtle hover fill only. */}
      <ProfileStrip data={profile} onClick={onProfileClick} className="px-2" />
    </div>
  )
}
