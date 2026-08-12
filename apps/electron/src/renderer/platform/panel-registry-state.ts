/**
 * Panel registry state (S-03 §3.7) — renderer-side model for
 * `panel-registry-state:${workspaceId}`.
 *
 * Pure helpers only; PanelHost.tsx consumes them. Invariants from S-03 §3.7:
 * parse-failure yields defaults (never throws), `version` is mandatory,
 * overrides are delta-only (keys set to `undefined` are dropped, empty
 * override objects are removed), state stays workspace-scoped.
 */

import {
  createPanelRegistry,
  type ContextKeys,
  type PanelContribution,
  type PanelOverride,
  type PanelRegistry,
  type PanelRegistryState,
  type PanelSlot,
} from '@craft-agent/core/platform'

export const DEFAULT_PANEL_REGISTRY_STATE: PanelRegistryState = {
  version: 1,
  rails: {},
  overrides: {},
  customProfiles: {},
}

function normalizeOverride(raw: unknown): PanelOverride | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const override: PanelOverride = {}
  if (typeof obj.order === 'number' && Number.isFinite(obj.order)) override.order = obj.order
  if (typeof obj.pinned === 'boolean') override.pinned = obj.pinned
  if (typeof obj.hidden === 'boolean') override.hidden = obj.hidden
  if (typeof obj.width === 'number' && Number.isFinite(obj.width)) override.width = obj.width
  return Object.keys(override).length > 0 ? override : null
}

/** Parse a raw persisted payload; unknown fields are tolerated best-effort. */
export function normalizePanelRegistryState(raw: unknown): PanelRegistryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PANEL_REGISTRY_STATE, rails: {}, overrides: {}, customProfiles: {} }
  }
  const obj = raw as Record<string, unknown>

  const rails: PanelRegistryState['rails'] = {}
  if (obj.rails && typeof obj.rails === 'object' && !Array.isArray(obj.rails)) {
    const rawRails = obj.rails as Record<string, unknown>
    if (rawRails.activity && typeof rawRails.activity === 'object') {
      const activity = rawRails.activity as Record<string, unknown>
      rails.activity = typeof activity.collapsed === 'boolean' ? { collapsed: activity.collapsed } : {}
    }
    if (rawRails.inspector && typeof rawRails.inspector === 'object') {
      const inspector = rawRails.inspector as Record<string, unknown>
      rails.inspector = {
        ...(typeof inspector.open === 'boolean' ? { open: inspector.open } : {}),
        ...(typeof inspector.activeInspector === 'string' ? { activeInspector: inspector.activeInspector } : {}),
        ...(typeof inspector.width === 'number' && Number.isFinite(inspector.width) ? { width: inspector.width } : {}),
      }
    }
  }

  const overrides: Record<string, PanelOverride> = {}
  if (obj.overrides && typeof obj.overrides === 'object' && !Array.isArray(obj.overrides)) {
    for (const [id, raw2] of Object.entries(obj.overrides as Record<string, unknown>)) {
      const override = normalizeOverride(raw2)
      if (override) overrides[id] = override
    }
  }

  const customProfiles: PanelRegistryState['customProfiles'] = {}
  if (obj.customProfiles && typeof obj.customProfiles === 'object' && !Array.isArray(obj.customProfiles)) {
    for (const [id, profile] of Object.entries(obj.customProfiles as Record<string, unknown>)) {
      if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
        customProfiles[id] = profile as PanelRegistryState['customProfiles'][string]
      }
    }
  }

  return {
    version: 1,
    ...(typeof obj.activeProfile === 'string' ? { activeProfile: obj.activeProfile } : {}),
    rails,
    overrides,
    customProfiles,
  }
}

/**
 * Merge a delta into one contribution's override. Keys patched with
 * `undefined` are removed (delta-only); an override that becomes empty is
 * dropped from the map.
 */
export function upsertPanelOverride(
  state: PanelRegistryState,
  contributionId: string,
  patch: Partial<Record<keyof PanelOverride, number | boolean | undefined>>,
): PanelRegistryState {
  const existing = state.overrides[contributionId] ?? {}
  const merged: Record<string, number | boolean> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  const overrides = { ...state.overrides }
  if (Object.keys(merged).length > 0) overrides[contributionId] = merged
  else delete overrides[contributionId]
  return { ...state, overrides }
}

/** Apply user overrides to an ordered contribution list: hide, then re-order. */
export function applyPanelOverrides(
  panels: readonly PanelContribution[],
  overrides: Record<string, PanelOverride>,
): PanelContribution[] {
  const visible = panels.filter((panel) => overrides[panel.id]?.hidden !== true)
  const orderOf = (panel: PanelContribution): number =>
    overrides[panel.id]?.order ?? panel.defaultOrder ?? Number.MAX_SAFE_INTEGER
  return [...visible].sort((a, b) => {
    const orderA = orderOf(a)
    const orderB = orderOf(b)
    if (orderA !== orderB) return orderA - orderB
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
}

/** Registry list + user overrides — the exact computation PanelHost renders. */
export function resolveSlotPanels(
  registry: PanelRegistry,
  slot: PanelSlot,
  ctx: ContextKeys,
  overrides: Record<string, PanelOverride>,
): PanelContribution[] {
  return applyPanelOverrides(registry.list(slot, ctx), overrides)
}

// -----------------------------------------------------------------------------
// App panel registry singleton (renderer). Core contributions register here;
// extension/siyuan-plugin sources arrive with their waves (S-05/S-06).
// -----------------------------------------------------------------------------

let appPanelRegistry: PanelRegistry | null = null

export function getAppPanelRegistry(): PanelRegistry {
  if (!appPanelRegistry) {
    appPanelRegistry = createPanelRegistry()
  }
  return appPanelRegistry
}
