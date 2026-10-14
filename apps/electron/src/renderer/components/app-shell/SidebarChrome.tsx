import * as React from 'react'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed } from './sidebar-guidance'
import { PromoSlot } from './PromoSlot'
import type { PromoKind } from '@/platform/promo-slot'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarChromeProps {
  workspaceId?: string | null
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
  collapsed?: boolean
}

/**
 * Second-sidebar footer. The profile lives only in the primary rail (one
 * 28px avatar → profile popover with Settings, plan/balance and tour), so
 * this footer carries just the compact promo hint and renders nothing when
 * there is no hint to show.
 */
export function SidebarChrome({
  workspaceId,
  promoKind,
  reminderDueCount,
  onPromoCta,
  collapsed = false,
}: SidebarChromeProps) {
  const [, invalidateGuidance] = React.useState(0)
  const guidanceDismissed = isSidebarGuidanceDismissed(workspaceId)
  const visiblePromoKind = promoKind === 'onboarding' && guidanceDismissed ? null : promoKind
  const onDismissGuidance = React.useCallback(() => {
    dismissSidebarGuidance(workspaceId)
    invalidateGuidance(revision => revision + 1)
    // The hint unmounts; hand focus to the rail profile avatar (the only profile entry point).
    if (typeof document !== 'undefined') document.querySelector<HTMLElement>('[data-rail-avatar]')?.focus()
  }, [workspaceId])
  if (!visiblePromoKind || collapsed) return null
  return (
    <div className="shrink-0 px-2 py-2" data-testid="sidebar-footer">
      <PromoSlot kind={visiblePromoKind} reminderDueCount={reminderDueCount} onCta={onPromoCta} onDismiss={visiblePromoKind === 'onboarding' ? onDismissGuidance : undefined} />
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
