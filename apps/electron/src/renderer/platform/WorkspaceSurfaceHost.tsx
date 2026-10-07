import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
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
import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'
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
  const harnessInspector = useAtomValue(featureWorkbenchHarnessInspectorV1Atom)
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
  const chrome = resolveWorkbenchChrome({
    unifiedShell,
    modeRegistry: false,
    topChrome: granularChrome && topChrome,
    tabGroups: granularChrome && tabGroups,
    browserSurface: granularChrome && browserSurface,
    statusBar: false,
    harnessInspector: granularChrome && harnessInspector,
  })

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-stretch">
      <div
        className="absolute right-0 top-0 bottom-0 z-50"
        style={{ width: edgeReveal.edgeZonePx }}
        onPointerEnter={edgeReveal.onEdgePointerEnter}
        onPointerLeave={edgeReveal.onEdgePointerLeave}
        data-testid="inspector-edge-zone"
        aria-hidden
      />
      {chrome.showRail && !ownsPrimaryNavigation && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {chrome.showSurfaceTabs && <SurfaceTabs />}
        {/* min-h-0 + flex-1 so chat yields height when the bottom terminal docks. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <BottomTerminalDock />
        <PanelHost slot="bottom" className="border-t border-foreground/5" />
      </div>
      <RetainedSurface visible={!inspectorSuppressed && (chrome.showInspector || inspectorVisible || chromeCollapsed)}>
        <InspectorHost />
      </RetainedSurface>
      <PanelHost slot="inspector" />
    </div>
  )
}
