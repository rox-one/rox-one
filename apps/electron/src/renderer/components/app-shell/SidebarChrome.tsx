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
  /** Renders the persistent "keep expanded" pin button. Available whenever the
   *  rail is expanded, not only during a hover peek. */
  showPin?: boolean
  /** Current pinned mode; drives the pressed state and label. */
  pinned?: boolean
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
  pinned = false,
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
{/* W-04: the control column stacks the persistent pin above the
          collapse/peek toggle, with the settings gear at the very bottom; the user
          plate sits below the whole column. A vertical stack keeps the order legible
          at the collapsed ~52px width, and `-mx-1.5` reclaims the shell padding so
          the column stays centred. */}
      <div className={cn('flex flex-col', collapsed ? '-mx-1.5 items-center gap-0.5' : 'items-start gap-1 px-1')}>
        {showPin ? (
          <button type="button" data-testid="rail-pin" onClick={onPin} aria-pressed={pinned} aria-label={t(pinned ? 'rail.unpin' : 'rail.pin')} title={t(pinned ? 'rail.unpin' : 'rail.pin')} className={cn('grid size-8 place-items-center rounded-lg text-foreground/80 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring', pinned && 'bg-surface-pressed text-foreground')}>
            <Pin className={cn('size-4', pinned && 'fill-current')} aria-hidden />
          </button>
        ) : null}
        <button type="button" data-testid="rail-toggle" onClick={onToggleSidebar} aria-label={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} title={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} aria-expanded={!collapsed} className={cn('grid place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring', collapsed ? 'size-6' : 'size-8')}>
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>
        <button type="button" data-testid="rail-settings" onClick={onOpenSettings} aria-label={t('sidebar.settings')} title={t('sidebar.settings')} className={cn('grid place-items-center rounded-lg text-foreground/45 hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring', collapsed ? 'size-6' : 'size-8')}>
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
      {/* Flat account row: no outline/shadow card, subtle hover fill only. Lowest element in the rail. */}
      <div ref={profileContainerRef} data-guidance-workspace={workspaceId || '_default'} className="w-full"><ProfileStrip data={profile} onClick={onProfileClick} compact={collapsed} className={cn('w-full', collapsed ? "px-0" : "px-2")} /></div>
    </div>
  )
}
