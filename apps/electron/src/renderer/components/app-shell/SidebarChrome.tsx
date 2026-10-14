import * as React from 'react'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed } from './sidebar-guidance'
import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarChromeProps {
  workspaceId?: string | null
  profile: ProfileStripData
  onProfileClick: () => void
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
  collapsed?: boolean
  /** Sidebar v2: «Настройки» opens from the profile popover (no footer gear). */
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
    <div className="rox-shell-divider-t shrink-0 space-y-2 px-1.5 py-2 pb-3" data-testid="sidebar-footer">
      {visiblePromoKind && !collapsed ? (
        <PromoSlot kind={visiblePromoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} onDismiss={visiblePromoKind === 'onboarding' ? onDismissGuidance : undefined} />
      ) : null}
      {/* Flat account row: no outline/shadow card, subtle hover fill only. Lowest element in the rail. */}
      <div ref={profileContainerRef} data-guidance-workspace={workspaceId || '_default'} className="w-full"><ProfileStrip data={profile} onClick={onProfileClick} onOpenSettings={onOpenSettings} compact={collapsed} className={cn('w-full', collapsed ? "px-0" : "px-2")} /></div>
    </div>
  )
}

interface SidebarHeaderControlsProps {
  collapsed: boolean
  onToggleSidebar?: () => void
  pinned?: boolean
  onPin?: () => void
}

/**
 * Sidebar v2 header: collapse/expand and pin/unpin side by side at the top
 * of the sidebar (next to the traffic-light / workspace area), instead of a
 * vertical stack above the avatar. Pin exists only while expanded; the
 * collapsed rail keeps just the expand chevron, centred.
 */
export function SidebarHeaderControls({ collapsed, onToggleSidebar, pinned = false, onPin }: SidebarHeaderControlsProps) {
  const { t } = useTranslation()
  const button = 'grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground outline-none transition-colors hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring titlebar-no-drag'
  return (
    <div data-testid="sidebar-header" className={cn('flex h-9 shrink-0 items-center gap-0.5', collapsed ? 'justify-center' : 'justify-end px-2')}>
      {!collapsed && onPin ? (
        <button type="button" data-testid="rail-pin" onClick={onPin} aria-pressed={pinned} aria-label={t(pinned ? 'rail.unpin' : 'rail.pin')} title={t(pinned ? 'rail.unpin' : 'rail.pin')} className={cn(button, pinned && 'bg-[var(--state-selected)] text-foreground')}>
          <Pin className={cn('size-3.5', pinned && 'fill-current')} aria-hidden />
        </button>
      ) : null}
      <button type="button" data-testid="rail-toggle" onClick={onToggleSidebar} aria-label={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} title={t(collapsed ? 'sidebar.show' : 'sidebar.hide')} aria-expanded={!collapsed} className={button}>
        {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
