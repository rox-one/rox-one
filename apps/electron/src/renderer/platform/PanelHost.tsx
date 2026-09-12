/**
 * PanelHost (W1 unified shell, spec S-03 §3.5) — renders the panels
 * registered for one `PanelSlot` in the app `PanelRegistry`
 * (`packages/core/src/platform/panels`).
 *
 * Behavior contract:
 * - lists contributions via `registry.list(slot, ctx)` (ordering + `when`
 *   context filtering live in the registry), then applies the user's
 *   delta-only overrides (hidden/order) from
 *   `panel-registry-state:${workspaceId}` (S-03 §3.7, KEYS.panelState);
 * - re-renders on `registry.onDidChange` and on workspace switch (state is
 *   re-read per workspace; absence/parse-failure yields defaults);
 * - renders nothing when the slot has no visible contributions. Core and
 *   runtime-gated Conation panels contribute to the `inspector` slot.
 *
 * The default context snapshot publishes `activeSurface` from the focused
 * panel route (`panelContextKeysFromRoute`); callers may pass a full
 * `contextKeys` to override.
 *
 * Write path for future panel chrome (hide/pin/reorder menus):
 * `upsertPanelOverride` + `storage.set(KEYS.panelState, …, workspaceId)` —
 * see panel-registry-state.ts.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type {
  ContextKeys,
  PanelRegistry,
  PanelRegistryState,
  PanelSlot,
} from '@craft-agent/core/platform'
import {
  featureWorkbenchConationInspectorAtom,
  featureWorkbenchConationShellAtom,
} from '@/atoms/conation-shell'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import {
  featureWorkbenchConationBoardAtom,
  featureWorkbenchConationCanvasAtom,
  featureWorkbenchConationNotesBridgeAtom,
} from '@/atoms/unified-shell'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import { cn } from '@/lib/utils'
import { registerCorePanels } from './core-panels'
import { KnowledgeInspectorPanel } from './KnowledgeInspectorPanel'
import { registerConationPanels } from './conation/conation-panels'
import { ConationInspectorPanel } from './conation/ConationInspectorPanel'
import { registerNotesPanel } from './conation/conation-notes-panels'
import {
  ConationNotesPanel,
  createConationNotesBridge,
} from './conation/ConationNotesPanel'
import { registerFundPanel } from './conation/conation-fund-panels'
import { ConationFundPanel } from './conation/ConationFundPanel'
import { registerBoardPanel } from './conation/conation-board-panels'
import { ConationBoardPanel } from './conation/ConationBoardPanel'
import {
  DEFAULT_PANEL_REGISTRY_STATE,
  getAppPanelRegistry,
  normalizePanelRegistryState,
  resolveSlotPanels,
} from './panel-registry-state'
import { panelContextKeysFromRoute } from './surface-tab-model'

registerCorePanels(getAppPanelRegistry(), KnowledgeInspectorPanel)

type AgentDebugWindow = Window & {
  __agentDebugLog?: (payload: {
    hypothesisId: string
    location: string
    message: string
    data: Record<string, unknown>
    timestamp: number
  }) => void
}

function agentDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return
  // #region agent log
  ;(window as AgentDebugWindow).__agentDebugLog?.({
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  })
  // #endregion
}

// #region agent log
agentDebugLog('C,E', 'PanelHost.tsx:module', 'panel host module evaluated', {
  bridgePresent:
    typeof window !== 'undefined'
    && typeof (window as AgentDebugWindow).__agentDebugLog === 'function',
})
// #endregion

export interface PanelHostProps {
  slot: PanelSlot
  /** Override the app singleton (tests / embedded hosts). */
  registry?: PanelRegistry
  /** Override the active workspace (defaults to windowWorkspaceIdAtom). */
  workspaceId?: string | null
  /** Override the when-context snapshot (defaults to { activeSurface }). */
  contextKeys?: ContextKeys
  className?: string
}

function loadPanelState(workspaceId: string | null): PanelRegistryState {
  if (!workspaceId) return { ...DEFAULT_PANEL_REGISTRY_STATE, rails: {}, overrides: {}, customProfiles: {} }
  return normalizePanelRegistryState(
    storage.get(KEYS.panelState, DEFAULT_PANEL_REGISTRY_STATE, workspaceId),
  )
}

export function PanelHost({
  slot,
  registry,
  workspaceId,
  contextKeys,
  className,
}: PanelHostProps) {
  const { t } = useTranslation()
  const windowWorkspaceId = useAtomValue(windowWorkspaceIdAtom)
  const activeWorkspaceId = workspaceId === undefined ? windowWorkspaceId : workspaceId
  const route = useAtomValue(focusedPanelRouteAtom)
  const conationShellEnabled = useAtomValue(featureWorkbenchConationShellAtom)
  const conationInspectorEnabled = useAtomValue(featureWorkbenchConationInspectorAtom)
  const conationCanvasEnabled = useAtomValue(featureWorkbenchConationCanvasAtom)
  const conationBoardEnabled = useAtomValue(featureWorkbenchConationBoardAtom)
  const conationNotesBridgeEnabled = useAtomValue(featureWorkbenchConationNotesBridgeAtom)

  const resolvedRegistry = registry ?? getAppPanelRegistry()
  const notesBridge = React.useMemo(
    () => createConationNotesBridge(
      typeof window === 'undefined' ? null : window.electronAPI,
      activeWorkspaceId,
    ),
    [activeWorkspaceId],
  )
  const renderNotesPanel = React.useCallback(
    () => <ConationNotesPanel bridge={notesBridge} />,
    [notesBridge],
  )
  const conationPanelTitle = t('settings.appearance.conationShell')
  const fundPanelTitle = t('conation.fund.title')
  const boardPanelTitle = t('conation.board.title')
  const notesPanelTitle = t('knowledge.nav.filterNotes')

  const [state, setState] = React.useState<PanelRegistryState>(() => loadPanelState(activeWorkspaceId))

  // Re-read per-workspace overrides on workspace switch (S-03 §3.7 invariant 4).
  React.useEffect(() => {
    setState(loadPanelState(activeWorkspaceId))
  }, [activeWorkspaceId])

  // Live re-render on (de)registration.
  const [registryVersion, setRegistryVersion] = React.useState(0)
  React.useEffect(() => {
    const sub = resolvedRegistry.onDidChange(() => {
      // #region agent log
      agentDebugLog('B,C', 'PanelHost.tsx:registry-listener', 'registry change observed', {
        slot,
      })
      // #endregion
      setRegistryVersion((v) => v + 1)
    })
    return () => sub.dispose()
  }, [resolvedRegistry, slot])

  // The inspector host owns runtime-gated Conation registrations. Cleanup only
  // disposes contributions this host registered; pre-existing owners are untouched.
  React.useEffect(() => {
    if (slot !== 'inspector') return

    // #region agent log
    agentDebugLog('B,C', 'PanelHost.tsx:registration-effect', 'registration effect entered', {
      shellEnabled: conationShellEnabled,
      inspectorEnabled: conationInspectorEnabled,
      inspectorPanelIdsBefore: resolvedRegistry.list('inspector', {}).map((panel) => panel.id),
    })
    // #endregion

    const inspectorRegistration = registerConationPanels(
      resolvedRegistry,
      ConationInspectorPanel,
      {
        shellEnabled: conationShellEnabled,
        inspectorEnabled: conationInspectorEnabled,
      },
      conationPanelTitle,
    )
    // Fund and Board remain deep-link panes; live canvas/kanban is out of scope.
    const fundRegistration = registerFundPanel(
      resolvedRegistry,
      ConationFundPanel,
      {
        shellEnabled: conationShellEnabled,
        inspectorEnabled: conationInspectorEnabled,
        canvasEnabled: conationCanvasEnabled,
      },
      fundPanelTitle,
    )
    const boardRegistration = registerBoardPanel(
      resolvedRegistry,
      ConationBoardPanel,
      {
        shellEnabled: conationShellEnabled,
        inspectorEnabled: conationInspectorEnabled,
        boardEnabled: conationBoardEnabled,
      },
      boardPanelTitle,
    )
    const notesRegistration = notesBridge
      ? registerNotesPanel(
          resolvedRegistry,
          renderNotesPanel,
          {
            shellEnabled: conationShellEnabled,
            inspectorEnabled: conationInspectorEnabled,
            notesBridgeEnabled: conationNotesBridgeEnabled,
          },
          notesPanelTitle,
        )
      : undefined

    // #region agent log
    agentDebugLog('A,B', 'PanelHost.tsx:registration-effect', 'registrations completed', {
      inspectorRegistered: Boolean(inspectorRegistration),
      fundRegistered: Boolean(fundRegistration),
      boardRegistered: Boolean(boardRegistration),
      notesRegistered: Boolean(notesRegistration),
      inspectorPanelIds: resolvedRegistry.list('inspector', {}).map((panel) => panel.id),
    })
    // #endregion

    return () => {
      // #region agent log
      agentDebugLog('B,C', 'PanelHost.tsx:registration-cleanup', 'registration cleanup entered', {
        shellEnabled: conationShellEnabled,
        inspectorEnabled: conationInspectorEnabled,
        inspectorRegistered: Boolean(inspectorRegistration),
        inspectorPanelIdsBeforeCleanup: resolvedRegistry.list('inspector', {}).map((panel) => panel.id),
      })
      // #endregion
      inspectorRegistration?.dispose()
      fundRegistration?.dispose()
      boardRegistration?.dispose()
      notesRegistration?.dispose()
    }
  }, [
    resolvedRegistry,
    slot,
    conationShellEnabled,
    conationInspectorEnabled,
    conationCanvasEnabled,
    conationBoardEnabled,
    conationNotesBridgeEnabled,
    notesBridge,
    renderNotesPanel,
    conationPanelTitle,
    fundPanelTitle,
    boardPanelTitle,
    notesPanelTitle,
  ])

  const ctx = React.useMemo<ContextKeys>(
    () => contextKeys ?? panelContextKeysFromRoute(route),
    [contextKeys, route],
  )

  const panels = React.useMemo(
    () => resolveSlotPanels(resolvedRegistry, slot, ctx, state.overrides)
      .filter((panel) => panel.source.id !== 'session-harness'),
    // registryVersion re-lists after registry mutations.
    [resolvedRegistry, slot, ctx, state.overrides, registryVersion],
  )

  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (slot !== 'inspector') return
    const host = hostRef.current
    const parent = host?.parentElement
    // #region agent log
    agentDebugLog('A,D', 'PanelHost.tsx:layout', 'inspector layout measured', {
      shellEnabled: conationShellEnabled,
      inspectorEnabled: conationInspectorEnabled,
      panelIds: panels.map((panel) => panel.id),
      viewportWidth: window.innerWidth,
      hostWidth: host ? Math.round(host.getBoundingClientRect().width) : null,
      parentWidth: parent ? Math.round(parent.getBoundingClientRect().width) : null,
      siblingWidths: parent
        ? Array.from(parent.children, (element) =>
            Math.round(element.getBoundingClientRect().width))
        : [],
    })
    // #endregion
  }, [slot, panels, conationShellEnabled, conationInspectorEnabled])

  if (panels.length === 0) return null

  return (
    <div ref={hostRef} className={cn('flex shrink-0 items-stretch', className)} data-panel-slot={slot}>
      {panels.map((panel) => {
        const PanelComponent = panel.render as React.ComponentType
        return <PanelComponent key={panel.id} />
      })}
    </div>
  )
}
