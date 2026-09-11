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
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchAvailability } from './workbench-rollout'

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

  if (availability !== 'enabled') return <>{children}</>

  return (
    <>
      <ActivityRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SurfaceTabs />
        {children}
        <BottomTerminalDock />
        <PanelHost slot="bottom" className="border-t border-foreground/5" />
      </div>
      <InspectorHost />
    </>
  )
}
