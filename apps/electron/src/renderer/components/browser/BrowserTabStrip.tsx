/**
 * BrowserTabStrip
 *
 * Rendered in the TopBar, shows compact badges for all active browser instances.
 * Each badge opens a shared action menu.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import * as Icons from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { panelStackAtom } from '@/atoms/panel-stack'
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
import { BrowserTabBadge } from './BrowserTabBadge'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { surfaceTabFromRoute } from '@/platform/layout-snapshot'
import { getHostname } from './utils'
import { useWorkspaceBrowserWindows } from './use-workspace-browser-windows'

const DEFAULT_MAX_VISIBLE_BADGES = 3

interface BrowserTabStripProps {
  activeSessionId?: string | null
  instancesOverride?: BrowserInstanceInfo[]
  maxVisibleBadges?: number
}

export function BrowserTabStrip({
  activeSessionId,
  instancesOverride,
  maxVisibleBadges = DEFAULT_MAX_VISIBLE_BADGES,
}: BrowserTabStripProps) {
  const { t } = useTranslation()
  const panelStack = useAtomValue(panelStackAtom)
  const {
    orderedInstances,
    embeddedInstances,
    activeInstanceId,
    focusBrowserWindow,
    openSessionUsingWindow,
    terminateBrowserWindow,
    liveWindowActions,
  } = useWorkspaceBrowserWindows({ activeSessionId, instancesOverride })

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
          onSelect={() => focusBrowserWindow(instance)}
        >
          <Icons.Monitor className="h-3.5 w-3.5" />
          {t('workbench.browser.showWindow')}
        </StyledDropdownMenuItem>

        <StyledDropdownMenuItem
          disabled={!canOpenSession}
          onSelect={() => openSessionUsingWindow(instance)}
        >
          <Icons.PanelRightOpen className="h-3.5 w-3.5" />
          {openSessionLabel}
        </StyledDropdownMenuItem>

        <StyledDropdownMenuSeparator />

        <StyledDropdownMenuItem
          variant="destructive"
          disabled={!liveWindowActions}
          onSelect={() => terminateBrowserWindow(instance)}
        >
          <Icons.XCircle className="h-3.5 w-3.5" />
          {t('workbench.browser.terminate')}
        </StyledDropdownMenuItem>
      </>
    )
  }, [t, liveWindowActions, focusBrowserWindow, openSessionUsingWindow, terminateBrowserWindow])

  const visibleBadgeCount = Math.max(1, maxVisibleBadges)
  const openBrowserInstanceIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of panelStack) {
      const surface = surfaceTabFromRoute(entry.route)
      if (surface?.kind === 'browser') {
        ids.add(surface.tabId)
      }
    }
    return ids
  }, [panelStack])
  const retainedEmbeddedInstances = useMemo(
    () => embeddedInstances.filter((instance) => !openBrowserInstanceIds.has(instance.id)),
    [embeddedInstances, openBrowserInstanceIds],
  )
  const badgeInstances = useMemo(
    () => [...orderedInstances, ...retainedEmbeddedInstances],
    [orderedInstances, retainedEmbeddedInstances],
  )
  const visible = useMemo(
    () => badgeInstances.slice(0, visibleBadgeCount),
    [badgeInstances, visibleBadgeCount],
  )
  const overflow = useMemo(
    () => badgeInstances.slice(visibleBadgeCount),
    [badgeInstances, visibleBadgeCount],
  )

  if (badgeInstances.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((instance) => (
        <DropdownMenu key={instance.id}>
          <DropdownMenuTrigger asChild>
            <BrowserTabBadge
              instance={instance}
              isActive={instance.id === activeInstanceId}
            />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-56">
            {renderBrowserActions(instance)}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      ))}

      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-[26px] px-1.5 rounded-lg text-[11px] text-foreground/50 bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors cursor-pointer titlebar-no-drag"
            >
              +{overflow.length}
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-64">
            {overflow.map((instance) => {
              const hostname = getHostname(instance.url)
              const displayLabel = instance.title.trim() || hostname || t('surfaceTabs.browser')
              return (
                <DropdownMenuSub key={instance.id}>
                  <StyledDropdownMenuSubTrigger>
                    {instance.isLoading ? (
                      <Spinner className="text-[10px]" />
                    ) : (
                      <Icons.Globe className="h-3.5 w-3.5" />
                    )}
                    <span className="truncate">{displayLabel}</span>
                  </StyledDropdownMenuSubTrigger>
                  <StyledDropdownMenuSubContent minWidth="min-w-56">
                    {renderBrowserActions(instance)}
                  </StyledDropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
