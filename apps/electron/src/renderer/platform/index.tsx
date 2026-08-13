/**
 * Unified shell platform hosts (W1) — barrel + the `UnifiedShellLayout`
 * gate. Spec: S-03 (rails/inspector), S-02 (surface tabs), ADR-0001 workbench seam.
 *
 * Mount contract (AppShell): wrap the existing `PanelStackContainer` JSX with
 * `UnifiedShellLayout`. When no workbench chrome flag (and no unified-shell
 * fallback) is on, the wrapper renders children unchanged.
 */
import type { ReactNode } from 'react'
import { featureUnifiedShellAtom, useWorkbenchFlag } from '@/atoms/unified-shell'
import { useAtomValue } from 'jotai'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { SurfaceTabs } from './SurfaceTabs'
import { StatusBarHost } from './StatusBarHost'

export { ActivityRail, ACTIVITY_RAIL_WIDTH, ACTIVITY_RAIL_COLLAPSED_WIDTH } from './ActivityRail'
export { SurfaceTabs } from './SurfaceTabs'
export { InspectorHost } from './InspectorHost'
export { Omnibox } from './Omnibox'
export { OmniboxHost } from './OmniboxHost'
export { ModeBar } from './ModeBar'
export { StatusBarHost, STATUS_BAR_HEIGHT } from './StatusBarHost'
export { parsePrefix, scoreMatch } from './omnibox-helpers'
export { useBrowserPaneLifecycle } from './browser-pane-lifecycle'

export function UnifiedShellLayout({ children }: { children: ReactNode }) {
  const unifiedShell = useAtomValue(featureUnifiedShellAtom)
  const modeRegistry = useWorkbenchFlag('workbench.mode-registry.v1')
  const tabGroups = useWorkbenchFlag('workbench.tab-groups.v2')
  const statusBar = useWorkbenchFlag('workbench.status-bar.v1')
  const showRail = unifiedShell || modeRegistry
  const showTabs = unifiedShell || tabGroups
  const showInspector = unifiedShell
  if (!showRail && !showTabs && !statusBar && !showInspector) return <>{children}</>

  return (
    <>
      {showRail && <ActivityRail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {showTabs && <SurfaceTabs />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {statusBar && <StatusBarHost />}
      </div>
      {showInspector && <InspectorHost />}
    </>
  )
}
