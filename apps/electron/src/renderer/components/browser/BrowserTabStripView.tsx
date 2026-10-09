/**
 * BrowserTabStripView
 *
 * The hook-free half of `BrowserTabStrip`: maps browser instances onto
 * `TabItem[]` and renders the shared tab primitive (`variant="browser"`,
 * spec D2 / W1.1). The primitive owns the ARIA pattern (`role=tablist/tab`,
 * `aria-selected`, roving tabindex), the keyboard (Arrow/Home/End,
 * Enter/Space, Delete/Backspace) and middle-click close.
 *
 * Selecting a tab focuses its window — the old badge menu's first item («Show
 * browser window»). Closing a tab (X, middle-click, Delete/Backspace)
 * terminates the window, because the strip lists live OS windows: a «closed»
 * tab whose window still runs would immediately reappear.
 *
 * ADR-0001 keeps these chips out of `SurfaceTabs` for the embedded-default
 * desktop path (#169; see the matching note in `platform/SurfaceTabs.tsx`), so
 * the per-instance menu lives here — in the strip's `trailing` slot — with the
 * same items as the removed badge dropdown (show / open session / terminate)
 * for every instance, visible or overflowed.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  Monitor,
  PanelRightOpen,
  XCircle,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { BrowserTabGlyph } from './BrowserTabGlyph'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { getHostname } from './utils'

export const DEFAULT_MAX_VISIBLE_BADGES = 3

export interface BrowserTabStripViewProps {
  /** Every instance, in display order (visible tabs + overflow). */
  instances: readonly BrowserInstanceInfo[]
  activeInstanceId: string | null
  maxVisibleBadges?: number
  liveWindowActions: boolean
  onFocusWindow(instance: BrowserInstanceInfo): void
  onOpenSession(instance: BrowserInstanceInfo): void
  onTerminate(instance: BrowserInstanceInfo): void
}

export function BrowserTabStripView({
  instances,
  activeInstanceId,
  maxVisibleBadges = DEFAULT_MAX_VISIBLE_BADGES,
  liveWindowActions,
  onFocusWindow,
  onOpenSession,
  onTerminate,
}: BrowserTabStripViewProps) {
  const { t } = useTranslation()

  const browserLabel = useCallback(
    (instance: BrowserInstanceInfo) =>
      instance.title.trim() || getHostname(instance.url) || t('surfaceTabs.browser'),
    [t],
  )

  const renderBrowserActions = useCallback((instance: BrowserInstanceInfo) => {
    const targetSessionId = instance.boundSessionId ?? instance.ownerSessionId
    const canOpenSession = !!targetSessionId
    const openSessionLabel = instance.agentControlActive
      ? t('workbench.browser.openSessionUsing')
      : t('workbench.browser.openSession')

    return (
      <>
        <StyledDropdownMenuItem
          disabled={!liveWindowActions}
          onSelect={() => onFocusWindow(instance)}
        >
          <Monitor className="icon-caption" />
          {t('workbench.browser.showWindow')}
        </StyledDropdownMenuItem>

        <StyledDropdownMenuItem
          disabled={!canOpenSession}
          onSelect={() => onOpenSession(instance)}
        >
          <PanelRightOpen className="icon-caption" />
          {openSessionLabel}
        </StyledDropdownMenuItem>

        <StyledDropdownMenuSeparator />

        <StyledDropdownMenuItem
          variant="destructive"
          disabled={!liveWindowActions}
          onSelect={() => onTerminate(instance)}
        >
          <XCircle className="icon-caption" />
          {t('workbench.browser.terminate')}
        </StyledDropdownMenuItem>
      </>
    )
  }, [t, liveWindowActions, onFocusWindow, onOpenSession, onTerminate])

  const visibleCount = Math.max(1, maxVisibleBadges)
  const visibleInstances = instances.slice(0, visibleCount)
  const overflowCount = instances.length - visibleInstances.length

  const tabItems: TabItem[] = visibleInstances.map((instance) => {
    const label = browserLabel(instance)
    return {
      id: instance.id,
      label,
      title: label,
      closable: true,
      icon: <BrowserTabGlyph instance={instance} />,
      badge: instance.agentControlActive
        ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        : undefined,
    }
  })

  if (instances.length === 0) return null

  return (
    <Tabs
      items={tabItems}
      activeId={activeInstanceId}
      variant="browser"
      density="compact"
      overflow="menu"
      keyboard
      className="min-w-0"
      ariaLabel={t('browser.tabsLabel')}
      closeLabel={t('browser.closeTab')}
      onSelect={(id) => {
        const instance = instances.find((item) => item.id === id)
        if (instance) onFocusWindow(instance)
      }}
      onClose={(id) => {
        const instance = instances.find((item) => item.id === id)
        if (instance) onTerminate(instance)
      }}
      trailing={(
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('browser.tabsMenu')}
              className="titlebar-no-drag inline-flex h-[var(--control-sm)] shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] px-1.5 text-caption font-medium text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {overflowCount > 0 && (
                <span className="tabular-nums">+{overflowCount}</span>
              )}
              <ChevronDown className="icon-status opacity-70" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-64">
            {instances.map((instance) => (
              <DropdownMenuSub key={instance.id}>
                <StyledDropdownMenuSubTrigger>
                  <BrowserTabGlyph instance={instance} />
                  <span className="truncate">{browserLabel(instance)}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-56">
                  {renderBrowserActions(instance)}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    />
  )
}