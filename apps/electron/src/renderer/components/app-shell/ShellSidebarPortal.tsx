import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { handleSidebarTreeKeyDown } from './sidebar-keyboard'
import { useSurfaceActive } from '@/lib/surface-keepalive'

/** Active panel navigators share the primary sidebar; other panels retain their own navigation. */
export const ShellSidebarContext = React.createContext<HTMLElement | null>(null)

/**
 * Split-view model: a SCREEN is a surface plus its secondary sidebar (only the
 * primary/focused panel owns the shared sidebar slot). Every other panel is a
 * bare PANEL — content only under a compact tile header. Inside a bare panel
 * the surface navigator is not rendered at all (no second sidebar), and page
 * titles equal to the tile title are suppressed (no duplicated headings).
 */
export interface BarePanelInfo { title: string | null }
export const BarePanelContext = React.createContext<BarePanelInfo | null>(null)

export function useBarePanel(): BarePanelInfo | null {
  return React.useContext(BarePanelContext)
}

/** True when a surface navigator has a home outside this panel (shared sidebar) or must not render (bare panel). */
export function useSidebarHandledOutside(): boolean {
  const target = useShellSidebarTarget()
  const bare = useBarePanel()
  return target != null || bare != null
}

/** Hide a page/list heading that only repeats the bare panel's tile title. */
export function useDedupedPanelTitle<T>(title: T): T | undefined {
  const bare = useBarePanel()
  if (bare?.title && typeof title === 'string' && title.trim() === bare.title.trim()) return undefined
  return title
}

export function useShellSidebarTarget(): HTMLElement | null {
  const target = React.useContext(ShellSidebarContext)
  // WP6: a retained (kept-alive, inactive) surface must not portal into the
  // shared slot — Notes showed the Входящие tree. It renders its nav inline in
  // its hidden pane instead (portal ↔ inline remounts the nav subtree, so the
  // nav's local UI state resets on activation; the surface's own state stays).
  const active = useSurfaceActive()
  return active ? target : null
}

export function ShellSidebarPortal({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const target = useShellSidebarTarget()
  const bare = useBarePanel()
  if (target) {
    return createPortal(
      <div onKeyDown={handleSidebarTreeKeyDown} className="flex min-h-0 flex-col gap-1 px-2 py-2" data-contextual-sidebar="true" data-testid={(props as { 'data-testid'?: string })['data-testid']}>
        {children}
      </div>, target,
    )
  }
  // A bare panel never renders a second sidebar: the shared slot shows only
  // the focused screen's navigation.
  if (bare) return null
  // Inline fallback is secondary chrome: grid tiles below the compact
  // threshold hide it (index.css, data-panel-density="grid").
  return <nav data-panel-secondary="" {...props} className={cn('flex flex-col', className)}>{children}</nav>
}
