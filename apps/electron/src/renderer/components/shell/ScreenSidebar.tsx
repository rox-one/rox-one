/** Renders a published ScreenSidebarConfig (header, primary action, search, groups). */
import * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarActions, SidebarSection, type SidebarMode } from './SidebarSection'
import { isSidebarSearchUsable, registerScreenSidebarSearch, type ScreenSidebarConfig } from './screen-sidebar'

export interface ScreenSidebarProps {
  config: ScreenSidebarConfig
  mode: Exclude<SidebarMode, 'hidden'>
  /** Extra header control from the shell (mode toggle). */
  headerTrailing?: React.ReactNode
}

export function ScreenSidebar({ config, mode, headerTrailing }: ScreenSidebarProps) {
  const primary = config.primaryAction
  const PrimaryIcon = primary?.icon
  const screenId = config.screenId
  const [searchEl, searchRef] = React.useState<HTMLInputElement | null>(null)
  useUsableSearchRegistration(screenId, searchEl)
  return (
    <div className="flex min-h-0 flex-col gap-1" data-screen-sidebar={config.screenId} data-sidebar-mode={mode}>
      {mode === 'expanded' ? (
        <div className="flex h-8 items-center gap-1 pl-2 pr-1" data-sidebar-screen-header="">
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold">{config.title}</h2>
          <SidebarActions actions={config.headerActions} />
          {headerTrailing}
        </div>
      ) : headerTrailing ? <div className="flex justify-center">{headerTrailing}</div> : null}
      {primary && (
        <button
          type="button"
          onClick={primary.onSelect}
          disabled={primary.disabled}
          aria-label={mode === 'icons' ? primary.label : undefined}
          title={mode === 'icons' ? primary.label : undefined}
          data-tour={primary.dataTour}
          data-sidebar-primary-action=""
          className={cn(
            'flex h-8 items-center gap-2 rounded-[var(--radius-control)] text-body font-medium text-foreground hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
            mode === 'icons' ? 'justify-center' : 'px-2',
          )}
        >
          {PrimaryIcon && <PrimaryIcon className="icon-caption shrink-0" aria-hidden />}
          {mode === 'expanded' && <span className="min-w-0 flex-1 truncate text-left">{primary.label}</span>}
          {mode === 'expanded' && primary.shortcut && <span className="text-caption text-muted-foreground">{primary.shortcut}</span>}
        </button>
      )}
      {mode === 'expanded' && config.search && (
        <label className="relative mx-1 block">
          <Search className="icon-caption pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={config.search.value}
            onChange={(event) => config.search?.onChange(event.target.value)}
            placeholder={config.search.placeholder}
            aria-label={config.search.placeholder}
            className="h-7 w-full rounded-[var(--radius-control)] border border-border-subtle bg-transparent pl-7 pr-2 text-body outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      )}
      <div className="flex min-h-0 flex-col">
        {config.groups.map((group) => (
          <SidebarSection key={group.id} screenId={config.screenId} group={group} mode={mode} />
        ))}
      </div>
      {mode === 'expanded' && config.footer}
    </div>
  )
}

/**
 * Register the search box only while it is really usable (expanded mode is
 * implied by it being rendered; also visible and wider than 0). Re-checks on
 * size changes of the box and the sidebar slot and on inert/aria-hidden flips.
 */
function useUsableSearchRegistration(screenId: string, el: HTMLInputElement | null): void {
  React.useLayoutEffect(() => {
    if (!el) return undefined
    const check = () => registerScreenSidebarSearch(screenId, isSidebarSearchUsable(el) ? el : null, el)
    check()
    const slot = el.closest<HTMLElement>('[data-panel-role="sidebar"]')
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null
    ro?.observe(el)
    if (slot) ro?.observe(slot)
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(check) : null
    mo?.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] })
    return () => {
      ro?.disconnect()
      mo?.disconnect()
      registerScreenSidebarSearch(screenId, null, el)
    }
  }, [screenId, el])
}
