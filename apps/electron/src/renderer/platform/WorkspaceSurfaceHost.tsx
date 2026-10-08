import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { activityRailCollapsedAtom } from '@/atoms/unified-shell'
import {
  featureUnifiedShellAtom,
  featureWorkbenchAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchHarnessInspectorV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
  inspectorChromeCollapsedAtom,
  inspectorVisibleAtom,
} from '@/atoms/unified-shell'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { useInspectorSuppressed } from './inspector-suppression'
import { PanelHost } from './PanelHost'
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchAvailability } from './workbench-rollout'
import { resolveWorkbenchChrome } from './workbench-chrome'
import { RetainedSurface } from './RetainedSurface'
import { useEdgeRevealPanel } from '@/hooks/useEdgeRevealPanel'

export interface WorkspaceSurfaceHostProps {
  children: ReactNode
  operatorCapability: unknown
  /** Optional test/integration override; omitted reads the persisted atom. */
  userPreference?: unknown
  /** AppShell supplies the single primary sidebar with contextual navigation. */
  ownsPrimaryNavigation?: boolean
}

export function WorkspaceSurfaceHost({
  children,
  operatorCapability,
  userPreference,
  ownsPrimaryNavigation = false,
}: WorkspaceSurfaceHostProps) {
  const persistedPreference = useAtomValue(featureWorkbenchAtom)
  const unifiedShell = useAtomValue(featureUnifiedShellAtom)
  const topChrome = useAtomValue(featureWorkbenchTopChromeV2Atom)
  const tabGroups = useAtomValue(featureWorkbenchTabGroupsV2Atom)
  const browserSurface = useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)
  const harnessInspectorEnabled = useAtomValue(featureWorkbenchHarnessInspectorV1Atom)
  const inspectorVisible = useAtomValue(inspectorVisibleAtom)
  const chromeCollapsed = useAtomValue(inspectorChromeCollapsedAtom)
  const inspectorSuppressed = useInspectorSuppressed()
  const availability = resolveWorkbenchAvailability(
    operatorCapability,
    userPreference === undefined ? persistedPreference : userPreference,
  )
  const workbenchEnabled = availability === 'enabled'
  const granularChrome = unifiedShell || workbenchEnabled
  const edgeReveal = useEdgeRevealPanel(granularChrome || ownsPrimaryNavigation)
  const setActivityRailCollapsed = useSetAtom(activityRailCollapsedAtom)
  const chrome = resolveWorkbenchChrome({
    unifiedShell,
    modeRegistry: false,
    topChrome: granularChrome && topChrome,
    tabGroups: granularChrome && tabGroups,
    browserSurface: granularChrome && browserSurface,
    statusBar: false,
    // The harness inspector dock is its own flag (default ON): the right rail,
    // the closed-by-default panel and edge hover-reveal must work without the
    // Workbench preference (TZ: «панель-вкладки-инспектор» включена по дефолту).
    harnessInspector: harnessInspectorEnabled,
  })

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-stretch">
      {/* Edge zones must sit above the panel stack (--z-panel: 50) so hover-reveal hits on every route; below --z-dropdown: 100. */}
      {chrome.showRail && !ownsPrimaryNavigation && (
        <div
          className="absolute left-0 top-0 bottom-0 z-[60]"
          style={{ width: edgeReveal.edgeZonePx }}
          onPointerEnter={() => setActivityRailCollapsed(false)}
          data-testid="activity-rail-edge-zone"
          aria-hidden
        />
      )}
      <div
        className="absolute right-0 top-0 bottom-0 z-[60]"
        style={{ width: edgeReveal.edgeZonePx }}
        onPointerEnter={edgeReveal.onEdgePointerEnter}
        onPointerLeave={edgeReveal.onEdgePointerLeave}
        data-testid="inspector-edge-zone"
        aria-hidden
      />
      {chrome.showRail && !ownsPrimaryNavigation && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {chrome.showSurfaceTabs && <SurfaceTabs />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <PanelHost slot="bottom" className="border-t border-foreground/5" />
      </div>
      <RetainedSurface visible={!inspectorSuppressed && (chrome.showInspector || inspectorVisible || chromeCollapsed)}>
        <InspectorHost />
      </RetainedSurface>
      <PanelHost slot="inspector" />
    </div>
  )
}
