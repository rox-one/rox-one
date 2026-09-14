import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { panelStackAtom } from '@/atoms/panel-stack'
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
import { isWebUI } from '@/lib/platform'
import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { PanelHost } from './PanelHost'
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchAvailability } from './workbench-rollout'
import { resolveWorkbenchChrome } from './workbench-chrome'
import { resolveWorkspaceSurfaceLayout } from './workspace-surface-layout'
import { RetainedSurface } from './RetainedSurface'

export interface WorkspaceSurfaceHostProps {
  children: ReactNode
  operatorCapability: unknown
  /** Optional test/integration override; omitted reads the persisted atom. */
  userPreference?: unknown
  isCompact?: boolean
  /** A single list does not need a generic empty "Panel" tab above it. */
  catalogOnly?: boolean
  onOpenBrowser?: () => void
}

export function WorkspaceSurfaceHost({
  children,
  operatorCapability,
  userPreference,
  isCompact = false,
  catalogOnly = false,
  onOpenBrowser,
}: WorkspaceSurfaceHostProps) {
  const panels = useAtomValue(panelStackAtom)
  const inspectorVisible = useAtomValue(inspectorVisibleAtom)
  const inspectorCollapsed = useAtomValue(inspectorChromeCollapsedAtom)
  const inspectorSection = useAtomValue(inspectorSectionAtom)
  const persistedPreference = useAtomValue(featureWorkbenchAtom)
  const availability = resolveWorkbenchAvailability(
    operatorCapability,
    userPreference === undefined ? persistedPreference : userPreference,
  )
  const workbenchEnabled = availability === 'enabled'
  const chrome = resolveWorkbenchChrome({
    unifiedShell: useAtomValue(featureUnifiedShellAtom) || workbenchEnabled,
    modeRegistry: false,
    topChrome: useAtomValue(featureWorkbenchTopChromeV2Atom) || workbenchEnabled,
    tabGroups: useAtomValue(featureWorkbenchTabGroupsV2Atom) || workbenchEnabled,
    browserSurface: useAtomValue(featureWorkbenchBrowserSurfaceV2Atom),
    statusBar: false,
    harnessInspector: useAtomValue(featureWorkbenchHarnessInspectorV1Atom) || workbenchEnabled,
  })

  // An explicit native browser open works even when the broader inspector
  // preference is off. Closing it removes this fallback without changing flags.
  const { showServiceRail, showTabs, showInspector, showAuxiliaryPanels } = resolveWorkspaceSurfaceLayout({
    isCompact,
    panelCount: panels.length,
    catalogOnly,
    chrome,
    browser: { isWebUI, visible: inspectorVisible, chromeCollapsed: inspectorCollapsed, section: inspectorSection },
  })

  // Keep the content ancestry stable when resizing or opening an inspector.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
      {showServiceRail && <ActivityRail onOpenBrowser={onOpenBrowser} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {showTabs && <SurfaceTabs />}
        {/* min-h-0 + flex-1 so chat yields height when the bottom terminal docks. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <RetainedSurface visible={showAuxiliaryPanels}>
          <BottomTerminalDock />
          <PanelHost slot="bottom" className="border-t border-foreground/5" />
        </RetainedSurface>
      </div>
      <RetainedSurface visible={showInspector}><InspectorHost /></RetainedSurface>
      <RetainedSurface visible={showAuxiliaryPanels}><PanelHost slot="inspector" /></RetainedSurface>
    </div>
  )
}
