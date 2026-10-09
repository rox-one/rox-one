/**
 * BrowserTabStrip
 *
 * The browser-instance strip of the TopBar. This file is the container: it
 * reads the panel stack (to drop embedded panes already open as panels) and the
 * workspace browser registry, then renders the hook-free `BrowserTabStripView`,
 * which owns the shared tab primitive (`variant="browser"`, spec D2 / W1.1),
 * the action menu and the anatomy. See that file for the behaviour contract.
 */

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { panelStackAtom } from '@/atoms/panel-stack'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { surfaceTabFromRoute } from '@/platform/layout-snapshot'
import { useWorkspaceBrowserWindows } from './use-workspace-browser-windows'
import { BrowserTabStripView, DEFAULT_MAX_VISIBLE_BADGES } from './BrowserTabStripView'

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
  const instances = useMemo(
    () => [...orderedInstances, ...retainedEmbeddedInstances],
    [orderedInstances, retainedEmbeddedInstances],
  )

  return (
    <BrowserTabStripView
      instances={instances}
      activeInstanceId={activeInstanceId}
      maxVisibleBadges={maxVisibleBadges}
      liveWindowActions={liveWindowActions}
      onFocusWindow={focusBrowserWindow}
      onOpenSession={openSessionUsingWindow}
      onTerminate={terminateBrowserWindow}
    />
  )
}