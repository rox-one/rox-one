import * as React from 'react'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed } from './sidebar-guidance'
import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Pin, Settings } from 'lucide-react'
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
  /** Renders the "keep expanded" pin button; only meaningful during a hover peek. */
  showPin?: boolean
  onPin?: () => void
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
  showPin = false,
  onPin,
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
      {/* A1/A7: [pin?] + gear + collapse toggle share one left-aligned row; the user plate sits below it.
          A1 (ТЗ): collapsed the rail is only 52px wide, so the gear and the collapse toggle sit on one
          height in a compact row (size-6 + 2px gap) instead of stacking; `-mx-1.5` reclaims the shell padding. */}
      <div className={cn('flex', collapsed ? '-mx-1.5 flex-row items-center justify-center gap-0.5' : 'flex-row items-center justify-start gap-1 px-1')}>
        {showPin && !collapsed ? (
          <button type="button" data-testid="rail-pin" onClick={onPin} aria-label={t('rail.pin')} title={t('rail.pin')} className="grid size-8 place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring">
            <Pin className="size-4" aria-hidden />
          </button>
        ) : null}
        <button type="button" data-testid="rail-settings" onClick={onOpenSettings} aria-label={t('sidebar.settings')} title={t('sidebar.settings')} className={cn('grid place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring', collapsed ? 'size-6' : 'size-8')}>
          <Settings className="size-4" aria-hidden />
        </button>
        <button type="button" data-testid="rail-toggle" onClick={onToggleSidebar} aria-label={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} title={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} aria-expanded={!collapsed} className={cn('grid place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring', collapsed ? 'size-6' : 'size-8')}>
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>
      </div>
      {/* Flat account row: no outline/shadow card, subtle hover fill only. Lowest element in the rail. */}
      <div ref={profileContainerRef} data-guidance-workspace={workspaceId || '_default'} className="w-full"><ProfileStrip data={profile} onClick={onProfileClick} compact={collapsed} className={cn('w-full', collapsed ? "px-0" : "px-2")} /></div>
    </div>
  )
}
