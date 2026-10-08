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
  inspectorSectionAtom,
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
import { resolveWorkspaceSurfaceLayout } from './workspace-surface-layout'
import { useEdgeRevealPanel } from '@/hooks/useEdgeRevealPanel'
import { panelStackAtom } from '@/atoms/panel-stack'
import { isWebUI } from '@/lib/platform'

export interface WorkspaceSurfaceHostProps {
  children: ReactNode
  operatorCapability: unknown
  /** Optional test/integration override; omitted reads the persisted atom. */
  userPreference?: unknown
  /** AppShell supplies the single primary sidebar with contextual navigation. */
  ownsPrimaryNavigation?: boolean
  /** AppShell collapsed to the compact layout, so the rail yields to the sidebar. */
  isCompact?: boolean
  /** The session catalog alone owns the workspace column, so generic tabs stay hidden. */
  catalogOnly?: boolean
  /** Explicit rail action for the browser surface when AppShell owns the window opener. */
  onOpenBrowser?: () => void
}

export function WorkspaceSurfaceHost({
  children,
  operatorCapability,
  userPreference,
  ownsPrimaryNavigation = false,
  isCompact = false,
  catalogOnly = false,
  onOpenBrowser,
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
  const setActivityRailCollapsed = useSetAtom(activityRailCollapsedAtom)
  const chrome = resolveWorkbenchChrome({
    unifiedShell,
    modeRegistry: false,
    topChrome: granularChrome && topChrome,
    tabGroups: granularChrome && tabGroups,
    browserSurface: granularChrome && browserSurface,
    statusBar: false,
    harnessInspector: granularChrome && harnessInspector,
  })
  const panels = useAtomValue(panelStackAtom)
  const inspectorSection = useAtomValue(inspectorSectionAtom)
  // Layout availability (compact / catalog-only) stays separate from stored flags:
  // the resolver decides which surfaces exist, the chrome flags decide rollout, and
  // AppShell ownership decides whether the primary rail would be duplicated.
  const layout = resolveWorkspaceSurfaceLayout({
    isCompact,
    panelCount: panels.length,
    catalogOnly,
    chrome,
    browser: {
      isWebUI,
      visible: inspectorVisible,
      chromeCollapsed,
      section: inspectorSection,
    },
  })
  const inspectorSurfaceVisible =
    !inspectorSuppressed && (layout.showInspector || inspectorVisible || chromeCollapsed)

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-stretch">
      {layout.showServiceRail && chrome.showRail && !ownsPrimaryNavigation && (
        <div
          className="absolute left-0 top-0 bottom-0 z-50"
          style={{ width: edgeReveal.edgeZonePx }}
          onPointerEnter={() => setActivityRailCollapsed(false)}
          data-testid="activity-rail-edge-zone"
          aria-hidden
        />
      )}
      <div
        className="absolute right-0 top-0 bottom-0 z-50"
        style={{ width: edgeReveal.edgeZonePx }}
        onPointerEnter={edgeReveal.onEdgePointerEnter}
        onPointerLeave={edgeReveal.onEdgePointerLeave}
        data-testid="inspector-edge-zone"
        aria-hidden
      />
      {layout.showServiceRail && chrome.showRail && !ownsPrimaryNavigation && (
        <ActivityRail onOpenBrowser={onOpenBrowser} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {layout.showTabs && <SurfaceTabs />}
        {/* min-h-0 + flex-1 so chat yields height when the bottom terminal docks. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <RetainedSurface visible={layout.showAuxiliaryPanels}>
          <BottomTerminalDock />
          <PanelHost slot="bottom" className="border-t border-foreground/5" />
        </RetainedSurface>
      </div>
      <RetainedSurface visible={inspectorSurfaceVisible}>
        <InspectorHost />
      </RetainedSurface>
      <RetainedSurface visible={layout.showAuxiliaryPanels}>
        <PanelHost slot="inspector" />
      </RetainedSurface>
    </div>
  )
}
