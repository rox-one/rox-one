import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import type { ComponentEntry } from './types'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { UnifiedShellLayout } from '@/platform'
import {
  activityRailCollapsedAtom,
  featureUnifiedShellAtom,
  inspectorSectionAtom,
  inspectorVisibleAtom,
  type InspectorSectionId,
} from '@/atoms/unified-shell'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { sessionMetaMapAtom, windowWorkspaceIdAtom, type SessionMeta } from '@/atoms/sessions'
import { KEYS, getKeyString } from '@/lib/local-storage'

const DEMO_WORKSPACE_ID = 'playground-unified-shell'

function mockMeta(id: string, title: string): SessionMeta {
  return {
    id,
    workspaceId: DEMO_WORKSPACE_ID,
    title,
    lastMessageAt: Date.now(),
    createdAt: Date.now() - 60_000,
  } as unknown as SessionMeta
}

const DEMO_PANELS: PanelStackEntry[] = [
  { id: 'panel-0', route: 'allSessions/session/demo-1', proportion: 0.5, panelType: 'session', laneId: 'main' },
  { id: 'panel-1', route: 'allSessions/session/demo-2', proportion: 0.5, panelType: 'session', laneId: 'main' },
]

interface HydrateShellProps {
  enabled: boolean
  inspectorVisible: boolean
  inspectorSection: InspectorSectionId
  railCollapsed: boolean
  children: React.ReactNode
}

/** Hydrates the isolated jotai store with flag + chrome + panel-stack state. */
function HydrateShell({ enabled, inspectorVisible, inspectorSection, railCollapsed, children }: HydrateShellProps) {
  const setFlag = useSetAtom(featureUnifiedShellAtom)
  const setInspectorVisible = useSetAtom(inspectorVisibleAtom)
  const setInspectorSection = useSetAtom(inspectorSectionAtom)
  const setRailCollapsed = useSetAtom(activityRailCollapsedAtom)
  const setWorkspaceId = useSetAtom(windowWorkspaceIdAtom)
  const setPanelStack = useSetAtom(panelStackAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const setMetaMap = useSetAtom(sessionMetaMapAtom)

  // Mount: apply prop defaults only for keys with no persisted value —
  // persisted chrome state (atomWithStorage) wins across reloads, which is
  // exactly the layout-restoration behavior this demo exercises.
  React.useEffect(() => {
    if (localStorage.getItem(getKeyString(KEYS.featureUnifiedShell)) === null) setFlag(enabled)
    if (localStorage.getItem(getKeyString(KEYS.inspectorVisible)) === null) setInspectorVisible(inspectorVisible)
    if (localStorage.getItem(getKeyString(KEYS.inspectorSection)) === null) setInspectorSection(inspectorSection)
    if (localStorage.getItem(getKeyString(KEYS.activityRailCollapsed)) === null) setRailCollapsed(railCollapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After mount, playground control/variant changes own the atoms.
  const prevProps = React.useRef({ enabled, inspectorVisible, inspectorSection, railCollapsed })
  React.useEffect(() => {
    const prev = prevProps.current
    if (prev.enabled !== enabled) setFlag(enabled)
    if (prev.inspectorVisible !== inspectorVisible) setInspectorVisible(inspectorVisible)
    if (prev.inspectorSection !== inspectorSection) setInspectorSection(inspectorSection)
    if (prev.railCollapsed !== railCollapsed) setRailCollapsed(railCollapsed)
    prevProps.current = { enabled, inspectorVisible, inspectorSection, railCollapsed }
  })

  React.useEffect(() => {
    setWorkspaceId(DEMO_WORKSPACE_ID)
    setPanelStack(DEMO_PANELS)
    setFocusedPanel('panel-0')
    setMetaMap(new Map([
      ['demo-1', mockMeta('demo-1', 'Quarterly planning')],
      ['demo-2', mockMeta('demo-2', 'Release retro')],
    ]))
  }, [setWorkspaceId, setPanelStack, setFocusedPanel, setMetaMap])

  return <>{children}</>
}

export interface UnifiedShellDemoProps {
  enabled: boolean
  inspectorVisible: boolean
  inspectorSection: InspectorSectionId
  railCollapsed: boolean
}

/**
 * Renders the production UnifiedShellLayout (ActivityRail + SurfaceTabs +
 * PanelHost + InspectorHost) around mock main content. The `enabled` control
 * flips featureUnifiedShellAtom live — OFF renders children unchanged
 * (classic shell), ON mounts the unified chrome.
 */
function UnifiedShellDemo({ enabled, inspectorVisible, inspectorSection, railCollapsed }: UnifiedShellDemoProps) {
  const store = React.useMemo(() => createStore(), [])
  const onCreateSession = React.useCallback(async () => {
    throw new Error('playground demo: session creation is not wired')
  }, [])

  return (
    <JotaiProvider store={store}>
      <HydrateShell
        enabled={enabled}
        inspectorVisible={inspectorVisible}
        inspectorSection={inspectorSection}
        railCollapsed={railCollapsed}
      >
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <EscapeInterruptProvider>
                <FocusProvider>
                  <NavigationProvider
                    workspaceId={DEMO_WORKSPACE_ID}
                    workspaceSlug="playground"
                    onCreateSession={onCreateSession}
                    isReady
                    isSessionsReady
                  >
                    <div
                      className="flex h-[560px] w-full overflow-hidden rounded-[10px] border border-border bg-background"
                      data-demo="unified-shell"
                    >
                      <UnifiedShellLayout>
                        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
                          Main surface (panel stack lives here in the app)
                        </div>
                      </UnifiedShellLayout>
                    </div>
                  </NavigationProvider>
                </FocusProvider>
              </EscapeInterruptProvider>
            </ModalProvider>
          </DismissibleLayerProvider>
        </ActionRegistryProvider>
      </HydrateShell>
    </JotaiProvider>
  )
}

export const unifiedShellComponents: ComponentEntry[] = [
  {
    id: 'unified-shell-layout',
    name: 'UnifiedShellLayout',
    category: 'Unified Shell',
    description:
      'Production shell chrome gate: flag OFF renders children unchanged (classic), flag ON mounts ActivityRail + SurfaceTabs + PanelHost + InspectorHost.',
    component: UnifiedShellDemo,
    layout: 'full',
    props: [
      { name: 'enabled', description: 'featureUnifiedShellAtom (wave flag)', control: { type: 'boolean' }, defaultValue: true },
      { name: 'inspectorVisible', description: 'Inspector panel visible', control: { type: 'boolean' }, defaultValue: true },
      {
        name: 'inspectorSection',
        description: 'Active inspector section',
        control: {
          type: 'select',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Agent', value: 'agent' },
            { label: 'Outline', value: 'outline' },
            { label: 'Backlinks', value: 'backlinks' },
          ],
        },
        defaultValue: 'info',
      },
      { name: 'railCollapsed', description: 'Activity rail collapsed', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Classic (flag OFF)', props: { enabled: false } },
      { name: 'Unified (flag ON)', props: { enabled: true } },
      { name: 'Unified + rail collapsed', props: { enabled: true, railCollapsed: true } },
    ],
  },
]
