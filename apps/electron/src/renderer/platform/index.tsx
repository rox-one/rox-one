/**
 * Unified shell platform hosts (W1 + Workbench v2 chrome) — barrel + the
 * `UnifiedShellLayout` gate. Spec: S-03 (rails/inspector), S-02 (surface tabs),
 * S-09 §3.1 (W1 scope, wave flag), ADR-0001 (granular workbench.* flags).
 *
 * Mount contract (AppShell): wrap the existing `PanelStackContainer` JSX with
 * `UnifiedShellLayout`. When every chrome flag is OFF the wrapper renders
 * children unchanged — zero behavioral delta.
 */
import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import {
  featureUnifiedShellAtom,
  featureWorkbenchBrowserSurfaceV2Atom,
  featureWorkbenchModeRegistryV1Atom,
  featureWorkbenchTabGroupsV2Atom,
  featureWorkbenchTopChromeV2Atom,
} from '@/atoms/unified-shell'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchChrome } from './workbench-chrome'

export { ActivityRail, ACTIVITY_RAIL_WIDTH, ACTIVITY_RAIL_COLLAPSED_WIDTH } from './ActivityRail'
export { SurfaceTabs } from './SurfaceTabs'
export { InspectorHost } from './InspectorHost'
export { ModeBar } from './ModeBar'
export { StatusBarHost } from './StatusBarHost'
export { Omnibox } from './Omnibox'
export { OmniboxHost } from './OmniboxHost'
export { parsePrefix, scoreMatch } from './omnibox-helpers'
export { resolveWorkbenchChrome, shouldShowStatusBar } from './workbench-chrome'

export function UnifiedShellLayout({ children }: { children: ReactNode }) {
  const chrome = resolveWorkbenchChrome({
    unifiedShell: useAtomValue(featureUnifiedShellAtom),
    modeRegistry: useAtomValue(featureWorkbenchModeRegistryV1Atom),
    topChrome: useAtomValue(featureWorkbenchTopChromeV2Atom),
    tabGroups: useAtomValue(featureWorkbenchTabGroupsV2Atom),
    browserSurface: useAtomValue(featureWorkbenchBrowserSurfaceV2Atom),
    statusBar: false,
  })

  if (!chrome.showRail && !chrome.showSurfaceTabs && !chrome.showInspector) {
    return <>{children}</>
  }

  return (
    <>
      {chrome.showRail && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {chrome.showSurfaceTabs && <SurfaceTabs />}
        {children}
      </div>
      {chrome.showInspector && <InspectorHost />}
    </>
  )
}
