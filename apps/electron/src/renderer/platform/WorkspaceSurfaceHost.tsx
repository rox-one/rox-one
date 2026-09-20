import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import {
  featureUnifiedShellAtom,
  featureWorkbenchAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchHarnessInspectorV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
  inspectorVisibleAtom,
} from '@/atoms/unified-shell'
import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { PanelHost } from './PanelHost'
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchAvailability } from './workbench-rollout'
import { resolveWorkbenchChrome } from './workbench-chrome'

export interface WorkspaceSurfaceHostProps {
  children: ReactNode
  operatorCapability: unknown
  /** Optional test/integration override; omitted reads the persisted atom. */
  userPreference?: unknown
}

export function WorkspaceSurfaceHost({
  children,
  operatorCapability,
  userPreference,
}: WorkspaceSurfaceHostProps) {
  const persistedPreference = useAtomValue(featureWorkbenchAtom)
  const unifiedShell = useAtomValue(featureUnifiedShellAtom)
  const topChrome = useAtomValue(featureWorkbenchTopChromeV2Atom)
  const tabGroups = useAtomValue(featureWorkbenchTabGroupsV2Atom)
  const browserSurface = useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)
  const harnessInspector = useAtomValue(featureWorkbenchHarnessInspectorV1Atom)
  const inspectorVisible = useAtomValue(inspectorVisibleAtom)
  const availability = resolveWorkbenchAvailability(
    operatorCapability,
    userPreference === undefined ? persistedPreference : userPreference,
  )
  const workbenchEnabled = availability === 'enabled'
  const granularChrome = unifiedShell || workbenchEnabled
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
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
      {chrome.showRail && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {chrome.showSurfaceTabs && <SurfaceTabs />}
        {/* min-h-0 + flex-1 so chat yields height when the bottom terminal docks. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <BottomTerminalDock />
        <PanelHost slot="bottom" className="border-t border-foreground/5" />
      </div>
      {(chrome.showInspector || inspectorVisible) && <InspectorHost />}
      <PanelHost slot="inspector" />
    </div>
  )
}
