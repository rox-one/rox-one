import * as React from 'react'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed } from './sidebar-guidance'
import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarChromeProps {
  workspaceId?: string | null
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
  workspaceId,
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
  const [, invalidateGuidance] = React.useState(0)
  const profileContainerRef = React.useRef<HTMLDivElement>(null)
  const guidanceDismissed = isSidebarGuidanceDismissed(workspaceId)
  const visiblePromoKind = promoKind === 'onboarding' && guidanceDismissed ? null : promoKind
  const onDismissGuidance = React.useCallback(() => {
    dismissSidebarGuidance(workspaceId)
    invalidateGuidance(revision => revision + 1)
    const container = profileContainerRef.current
    if (container?.isConnected && container.dataset.guidanceWorkspace === (workspaceId || '_default')
      && !container.closest('[hidden], [inert], [aria-hidden="true"]')) {
      container.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }, [workspaceId])
  return (
    <div className="rox-shell-divider-t shrink-0 space-y-3 px-1.5 py-2 pb-3">
      {visiblePromoKind && !collapsed ? (
        <PromoSlot kind={visiblePromoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} onDismiss={visiblePromoKind === 'onboarding' ? onDismissGuidance : undefined} />
      ) : null}
      {/* Flat account row: no outline/shadow card, subtle hover fill only. */}
      <div ref={profileContainerRef} data-guidance-workspace={workspaceId || '_default'}><ProfileStrip data={profile} onClick={onProfileClick} compact={collapsed} className={collapsed ? "px-0" : "px-2"} /></div>
      <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center justify-between px-1')}>
{onOpenSettings && <button type="button" onClick={onOpenSettings} aria-label={t('sidebar.settings')} title={t('sidebar.settings')} className="grid size-8 place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring">
          <Settings className="size-4" aria-hidden />
        </button>}
        <button type="button" onClick={onToggleSidebar} aria-label={t(collapsed ? 'rail.expand' : 'rail.collapse')} title={t(collapsed ? 'rail.expand' : 'rail.collapse')} aria-expanded={!collapsed} className="grid size-8 place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring">
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  )
}
