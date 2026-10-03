import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarChromeProps {
  profile: ProfileStripData
  onProfileClick: () => void
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
  collapsed?: boolean
  onToggleSidebar?: () => void
  onOpenSettings?: () => void
}

export function SidebarChrome({
  profile,
  onProfileClick,
  promoKind,
  reminderDueCount,
  onPromoCta,
  collapsed = false,
  onToggleSidebar,
  onOpenSettings,
}: SidebarChromeProps) {
  const { t } = useTranslation()
  return (
    <div className="rox-shell-divider-t shrink-0 space-y-2 px-1.5 py-2">
      {promoKind && !collapsed ? (
        <PromoSlot kind={promoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} />
      ) : null}
      {/* Flat account row: no outline/shadow card, subtle hover fill only. */}
      <ProfileStrip data={profile} onClick={onProfileClick} compact={collapsed} className={collapsed ? "px-0" : "px-2"} />
      <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center justify-between px-1')}>
        <button type="button" onClick={onOpenSettings} aria-label={t('sidebar.settings')} title={t('sidebar.settings')} className="grid size-8 place-items-center rounded-lg text-foreground/60 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring">
          <Settings className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={onToggleSidebar} aria-label={t(collapsed ? 'rail.expand' : 'rail.collapse')} title={t(collapsed ? 'rail.expand' : 'rail.collapse')} aria-expanded={!collapsed} className="grid size-8 place-items-center rounded-lg text-foreground/60 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring">
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  )
}
