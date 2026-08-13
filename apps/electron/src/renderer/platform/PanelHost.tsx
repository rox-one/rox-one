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
 * - renders nothing when the slot has no visible contributions. Ticket 11
 *   registers `knowledge.inspector` on slot `inspector`; other slots stay
 *   empty until later waves.
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
import type {
  ContextKeys,
  PanelRegistry,
  PanelRegistryState,
  PanelSlot,
} from '@craft-agent/core/platform'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import { cn } from '@/lib/utils'
import { registerCorePanels } from './core-panels'
import { KnowledgeInspectorPanel } from './KnowledgeInspectorPanel'
import {
  DEFAULT_PANEL_REGISTRY_STATE,
  getAppPanelRegistry,
  normalizePanelRegistryState,
  resolveSlotPanels,
} from './panel-registry-state'
import { panelContextKeysFromRoute } from './surface-tab-model'

registerCorePanels(getAppPanelRegistry(), KnowledgeInspectorPanel)

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
  const windowWorkspaceId = useAtomValue(windowWorkspaceIdAtom)
  const activeWorkspaceId = workspaceId === undefined ? windowWorkspaceId : workspaceId
  const route = useAtomValue(focusedPanelRouteAtom)

  const resolvedRegistry = registry ?? getAppPanelRegistry()

  const [state, setState] = React.useState<PanelRegistryState>(() => loadPanelState(activeWorkspaceId))

  // Re-read per-workspace overrides on workspace switch (S-03 §3.7 invariant 4).
  React.useEffect(() => {
    setState(loadPanelState(activeWorkspaceId))
  }, [activeWorkspaceId])

  // Live re-render on (de)registration.
  const [registryVersion, setRegistryVersion] = React.useState(0)
  React.useEffect(() => {
    const sub = resolvedRegistry.onDidChange(() => setRegistryVersion((v) => v + 1))
    return () => sub.dispose()
  }, [resolvedRegistry])

  const ctx = React.useMemo<ContextKeys>(
    () => contextKeys ?? panelContextKeysFromRoute(route),
    [contextKeys, route],
  )

  const panels = React.useMemo(
    () => resolveSlotPanels(resolvedRegistry, slot, ctx, state.overrides),
    // registryVersion re-lists after registry mutations.
    [resolvedRegistry, slot, ctx, state.overrides, registryVersion],
  )

  if (panels.length === 0) return null

  return (
    <div className={cn('flex shrink-0 items-stretch', className)} data-panel-slot={slot}>
      {panels.map((panel) => {
        const PanelComponent = panel.render as React.ComponentType
        return <PanelComponent key={panel.id} />
      })}
    </div>
  )
}
