import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { handleSidebarTreeKeyDown } from './sidebar-keyboard'
import { useSurfaceActive } from '@/lib/surface-keepalive'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Active panel navigators share the primary sidebar; other panels retain their own navigation. */
export const ShellSidebarContext = React.createContext<HTMLElement | null>(null)

/**
 * Split-view model: a SCREEN is a surface plus its secondary sidebar (only the
 * primary/focused panel owns the shared sidebar slot). Every other panel is a
 * bare PANEL — content only under a compact tile header. Inside a bare panel
 * the surface navigator is not rendered at all (no second sidebar), and page
 * titles equal to the tile title are suppressed (no duplicated headings).
 */
export interface BarePanelInfo {
  /** Translated tile title. */
  title: string | null
  /** i18n key of the tile title (surface id), for key-based dedupe. */
  titleKey?: string | null
  /** Slot in the compact tile header that receives the panel's navigation control. */
  controlsSlot?: HTMLElement | null
}
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

/** Plain text of a heading node (strings, numbers and nested elements). */
export function headingText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(headingText).join(' ')
  if (React.isValidElement(node)) return headingText((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** Normalize a heading for comparison: case, whitespace, counters and punctuation. */
export function normalizeHeading(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[([{]?\s*\d[\d\s.,]*\s*[)\]}]?/g, ' ')
    .replace(/[·•:—–\-|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when `title` (text, node or i18n key) only repeats the bare panel's tile title. */
export function isDuplicatePanelTitle(bare: BarePanelInfo | null, title: React.ReactNode, titleKey?: string | null): boolean {
  if (!bare) return false
  if (titleKey && bare.titleKey && titleKey === bare.titleKey) return true
  if (!bare.title) return false
  const text = normalizeHeading(headingText(title))
  return text.length > 0 && text === normalizeHeading(bare.title)
}

/** Hide a page/list heading that only repeats the bare panel's tile title. */
export function useDedupedPanelTitle<T extends React.ReactNode>(title: T, titleKey?: string | null): T | undefined {
  const bare = useBarePanel()
  return isDuplicatePanelTitle(bare, title, titleKey) ? undefined : title
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

export interface ShellSidebarPortalProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * How the navigation is presented in a bare split panel (never as a second
   * sidebar column): `popover` = compact button in the tile header opening the
   * nav; `strip` = compact horizontal strip in the tile header.
   */
  bareMode?: 'popover' | 'strip'
  /** i18n key of the compact header button label in a bare panel. */
  bareLabelKey?: string
}

/** Compact in-header presentation of a screen's navigation inside a bare panel. */
export function BarePanelControls({ mode, labelKey, testId, children }: { mode: 'popover' | 'strip'; labelKey: string; testId?: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const bare = useBarePanel()
  const slot = bare?.controlsSlot
  if (!slot) return null
  const label = t(labelKey)
  const body = mode === 'strip' ? (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto [&_[role=tablist]]:flex-row [&_[role=tablist]]:gap-1" data-bare-controls="strip" data-testid={testId ? `${testId}-bare` : undefined} aria-label={label}>
      {children}
    </div>
  ) : (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-bare-controls="popover"
          data-testid={testId ? `${testId}-bare` : undefined}
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-xs text-text-secondary outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <PanelLeft className="icon-status" aria-hidden />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(70vh,520px)] w-64 overflow-y-auto p-1">
        <nav aria-label={label} onKeyDown={handleSidebarTreeKeyDown} className="flex flex-col gap-0.5" data-bare-controls-content="">
          {children}
        </nav>
      </PopoverContent>
    </Popover>
  )
  return createPortal(body, slot)
}

export function ShellSidebarPortal({ children, className, bareMode = 'popover', bareLabelKey = 'navigation.barePanel.navigation', ...props }: ShellSidebarPortalProps) {
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
  if (bare) {
    return <BarePanelControls mode={bareMode} labelKey={bareLabelKey} testId={(props as { 'data-testid'?: string })['data-testid']}>{children}</BarePanelControls>
  }
  // Inline fallback is secondary chrome: grid tiles below the compact
  // threshold hide it (index.css, data-panel-density="grid").
  return <nav data-panel-secondary="" {...props} className={cn('flex flex-col', className)}>{children}</nav>
}

/** Page heading that disappears when it only repeats the bare panel's tile title. */
export function PanelHeading({ as = 'h1', titleKey, children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3'; titleKey?: string }) {
  const shown = useDedupedPanelTitle(children, titleKey)
  if (shown == null) return null
  return React.createElement(as, props, shown)
}
