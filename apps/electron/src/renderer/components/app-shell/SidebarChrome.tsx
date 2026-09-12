import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { MiniDashboardCards } from './MiniDashboardCards'
import { PromoSlot } from './PromoSlot'
import type { MiniDashboardSnapshot } from '@/platform/mini-dashboard'
import type { PromoKind } from '@/platform/promo-slot'

interface SidebarChromeProps {
  profile: ProfileStripData
  onProfileClick: () => void
  snapshot: MiniDashboardSnapshot
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
}

export function SidebarChrome({
  profile,
  onProfileClick,
  snapshot,
  promoKind,
  reminderDueCount,
  onPromoCta,
}: SidebarChromeProps) {
  return (
    <div className="shrink-0 space-y-2 border-t border-border/40 px-1.5 py-2">
      {promoKind ? (
        <PromoSlot kind={promoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} />
      ) : null}
      <MiniDashboardCards snapshot={snapshot} />
      <ProfileStrip data={profile} onClick={onProfileClick} className="rox-card px-2" />
    </div>
  )
}
