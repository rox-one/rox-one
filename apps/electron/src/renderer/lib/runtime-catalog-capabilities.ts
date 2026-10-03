import type { CapabilityRef, RuntimeEvent } from '@rox/core/runtime-trace'
import type { RuntimeTraceScope, RuntimeTraceSessionState } from '../atoms/runtime-trace'
import type { LoadedSkill } from '../../shared/types'

export interface RuntimeCatalogCapabilities {
  available: CapabilityRef[]
  selected: CapabilityRef[]
  loaded: CapabilityRef[]
  applied: CapabilityRef[]
  usedCapabilities: CapabilityRef[]
}

/** Retained chat selection is meaningful only in the active authorized workspace. */
export function runtimeCatalogScope(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  sessionWorkspaceId: string | null | undefined,
  remoteWorkspaceId?: string,
): RuntimeTraceScope | undefined {
  if (!workspaceId || !sessionId || !sessionWorkspaceId
    || sessionWorkspaceId !== workspaceId && sessionWorkspaceId !== remoteWorkspaceId) return undefined
  return { workspaceId: sessionWorkspaceId, sessionId }
}

const key = (ref: CapabilityRef): string => JSON.stringify([ref.kind, ref.scope, ref.id])

/** Read observed lifecycle phases; installing/selecting a skill is never proof of applying it. */
export function runtimeCatalogCapabilities(
  state: RuntimeTraceSessionState,
  scope: RuntimeTraceScope | undefined,
  skills: readonly LoadedSkill[] = [],
): RuntimeCatalogCapabilities {
  const available = skills.filter(skill => !skill.shadowedByCraft).map(skill => ({ kind: 'skill' as const, id: skill.slug, scope: skill.source, label: skill.metadata.name }))
  const result: RuntimeCatalogCapabilities = { available, selected: [], loaded: [], applied: [], usedCapabilities: [] }
  if (!scope) return result
  const rootRunId = state.activeRootRunId ?? state.runs.at(-1)?.rootRunId
  const projection = rootRunId ? state.projections[rootRunId] : undefined
  const canonicalSessionId = state.canonicalSessionId ?? scope.sessionId
  if (!projection || projection.scope.workspaceId !== scope.workspaceId || projection.scope.sessionId !== canonicalSessionId
    || projection.scope.rootRunId !== rootRunId) return result

  const selected = new Map<string, CapabilityRef>(); const loaded = new Map<string, CapabilityRef>()
  const applied = new Map<string, CapabilityRef>(); const used = new Map<string, CapabilityRef>()
  const resolve = (ref: CapabilityRef, observedSessionId: string | undefined): CapabilityRef => {
    if (ref.kind !== 'skill' || ref.scope !== 'session' || observedSessionId !== scope.sessionId) return ref
    // Session-scoped activation records identify a slug, not its installed origin.
    // A unique canonical resolution is required; duplicate names/scopes are never guessed.
    const matches = skills.filter(skill => skill.slug === ref.id && !skill.shadowedByCraft)
    return matches.length === 1 ? { ...ref, scope: matches[0]!.source, label: matches[0]!.metadata.name } : ref
  }
  const add = (target: Map<string, CapabilityRef>, ref: CapabilityRef, event: RuntimeEvent) => { const resolved = resolve(ref, event.sessionId); target.set(key(resolved), resolved) }
  const observe = (event: RuntimeEvent) => {
    if (event.workspaceId !== scope.workspaceId || event.rootSessionId !== canonicalSessionId || event.rootRunId !== rootRunId) return
    switch (event.kind) {
      case 'skill.selected': if (event.payload.capability.kind === 'skill') add(selected, event.payload.capability, event); break
      case 'skill.loaded': if (event.payload.capability.kind === 'skill') { add(loaded, event.payload.capability, event); add(used, event.payload.capability, event) } break
      case 'skill.applied': if (event.payload.capability.kind === 'skill') { add(applied, event.payload.capability, event); add(used, event.payload.capability, event) } break
      case 'tool.started': case 'tool.output': case 'tool.completed':
        if (event.payload.capability) add(used, event.payload.capability, event)
        break
      case 'context.captured': case 'context.changed':
        for (const block of event.payload.snapshot.blocks) if (block.included && block.kind === 'skill' && block.capability?.kind === 'skill') {
          add(loaded, block.capability, event); add(used, block.capability, event)
        }
        if (event.payload.snapshot.model.confirmed.state === 'known' && event.payload.snapshot.model.connection) add(used, event.payload.snapshot.model.connection, event)
        break
      case 'model.confirmed': case 'model.changed':
        if (event.payload.model.confirmed.state === 'known' && event.payload.model.connection) add(used, event.payload.model.connection, event)
        break
    }
  }
  for (const page of projection.eventPages) for (const event of page) observe(event)
  return { available, selected: [...selected.values()], loaded: [...loaded.values()], applied: [...applied.values()], usedCapabilities: [...used.values()] }
}
