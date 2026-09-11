import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import {
  featureUnifiedShellAtom,
  featureWorkbenchAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchHarnessInspectorV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
} from '@/atoms/unified-shell'
import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { PanelHost } from './PanelHost'
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

  if (!chrome.showRail && !chrome.showSurfaceTabs && !chrome.showInspector) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
      {chrome.showRail && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* min-h-0 + flex-1 so chat yields height when the bottom terminal docks. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        <BottomTerminalDock />
        <PanelHost slot="bottom" className="border-t border-foreground/5" />
      </div>
      {chrome.showInspector && <InspectorHost />}
      <PanelHost slot="inspector" />
    </div>
  )
}
