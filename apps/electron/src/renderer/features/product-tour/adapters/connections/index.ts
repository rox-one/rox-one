import type { LoadedSource, LoadedSkill } from '../../../../../shared/types'
import type { CapabilitySnapshot, TourCapability, TourScope, TourSignal } from '../../contracts'
import type { TourObservation } from '../../runtime/hooks'
import { LLM_TOOL_NAME_PATTERN, proxyToolNamePrefix } from '../../../../../../../../packages/shared/src/mcp/proxy-tool-name'

export interface PublishedSourceTool { readonly name: string; readonly sourceSlug: string }

/** Native pool proxy names are opaque keys. Never attribute an arbitrary substring. */
export function resolvePublishedToolSource(toolName: string, enabledSourceSlugs: readonly string[], published?: readonly PublishedSourceTool[]): string | null {
  if (!LLM_TOOL_NAME_PATTERN.test(toolName)) return null
  const enabled = [...new Set(enabledSourceSlugs)].filter(slug => slug !== 'session')
  if (published) {
    const matches = published.filter(tool => tool.name === toolName && enabled.includes(tool.sourceSlug))
    const slugs = new Set(matches.map(tool => tool.sourceSlug))
    return slugs.size === 1 ? [...slugs][0]! : null
  }
  // tool_start comes from the native pool dispatch. Use its canonical namespace;
  // absent an inventory, sanitized slug aliases and nested prefixes fail closed.
  const matches = enabled.filter(slug => {
    const prefix = proxyToolNamePrefix(slug)
    return toolName.startsWith(prefix) && toolName.length > prefix.length
  })
  return matches.length === 1 ? matches[0]! : null
}

export function sourceReadiness(source: LoadedSource, localMcpEnabled: boolean | null = null): TourCapability {
  const { config } = source
  if (!config.enabled || (config.mcp?.transport === 'stdio' && localMcpEnabled === false)) return { state: 'unavailable', reason: 'not-connected' }
  if (config.connectionStatus === 'needs_auth') return { state: 'denied', reason: 'not-authorized' }
  if (config.connectionStatus === 'failed') return { state: 'unavailable', reason: 'not-connected' }
  if (config.connectionStatus === 'local_disabled') return { state: 'unavailable', reason: 'not-connected' }
  const auth = config.mcp?.authType ?? config.api?.authType
  if (auth && auth !== 'none' && config.isAuthenticated !== true) return { state: 'denied', reason: 'not-authorized' }
  if (config.mcp?.transport === 'stdio' && localMcpEnabled === null) return { state: 'pending', reason: 'api-unavailable' }
  if (config.connectionStatus === 'connected' || config.type === 'local') return { state: 'ready' }
  return { state: 'pending', reason: source.isBuiltin ? 'installing' : 'not-connected' }
}

export interface ConnectionCapabilityInput {
  readonly sources?: readonly LoadedSource[]
  readonly workspaceId?: string
  readonly selectedSlugs?: readonly string[]
  readonly sourcesLoading?: boolean
  readonly sourcesUnavailable?: boolean
  readonly localMcpEnabled?: boolean | null
  readonly skills?: readonly LoadedSkill[]
  readonly fabric?: 'loading' | 'ready' | 'unavailable' | 'error'
}
/** Deliberately supplies no first-conversation or LLM capability. */
export function connectionCapabilities(input: ConnectionCapabilityInput): CapabilitySnapshot {
  const capabilities: Partial<Record<keyof CapabilitySnapshot, TourCapability>> = {}
  if (input.sources) {
    capabilities['sources.list'] = input.sourcesUnavailable ? { state: 'unavailable', reason: 'api-unavailable' } : input.sourcesLoading ? { state: 'pending', reason: 'installing' } : { state: 'ready' }
    const scoped = input.workspaceId ? input.sources.filter(source => source.workspaceId === input.workspaceId) : input.sources
    const selected = input.selectedSlugs ? scoped.filter(source => input.selectedSlugs!.includes(source.config.slug)) : scoped
    const readiness = selected.map(source => sourceReadiness(source, input.localMcpEnabled))
    capabilities['sources.ready'] = readiness.some(state => state.state === 'ready') ? { state: 'ready' } : readiness.find(state => state.state === 'pending') ?? readiness[0] ?? { state: 'unavailable', reason: 'missing-entity' }
    if (input.sourcesLoading) capabilities['sources.ready'] = { state: 'pending', reason: 'installing' }
    if (input.sourcesUnavailable) capabilities['sources.ready'] = { state: 'unavailable', reason: 'api-unavailable' }
  }
  if (input.skills) capabilities['skills.available'] = input.skills.length ? { state: 'ready' } : { state: 'unavailable', reason: 'missing-entity' }
  if (input.fabric) capabilities['connection-fabric.available'] = input.fabric === 'ready' ? { state: 'ready' } : input.fabric === 'loading' ? { state: 'pending', reason: 'not-connected' } : { state: 'unavailable', reason: 'api-unavailable' }
  return capabilities
}

export type ConnectionObservation =
  | { readonly kind: 'source-details'; readonly source: LoadedSource | null; readonly loading: boolean }
  | { readonly kind: 'audit-view'; readonly tab: string; readonly state: 'loading' | 'ready' | 'unavailable' | 'error' }
  | { readonly kind: 'skill-selection'; readonly selected: boolean; readonly userInitiated: boolean }

/** Called after native rendering/selection; cannot perform OAuth, grants, imports or send. */
export function deriveConnectionSignals(observation: TourObservation | null, scope: TourScope, evidence: ConnectionObservation): readonly TourSignal[] {
  if (!observation || observation.binding.workspaceId !== scope.workspaceId || observation.binding.panelId !== scope.panelId || observation.binding.sessionId !== scope.sessionId) return []
  let name: TourSignal['name']
  if (evidence.kind === 'source-details') {
    if (evidence.loading || !evidence.source || evidence.source.workspaceId !== scope.workspaceId || (scope.entityId && scope.entityId !== evidence.source.config.slug)) return []
    name = 'source.details-visible'
  } else if (evidence.kind === 'audit-view') {
    if (evidence.tab !== 'audit' || evidence.state !== 'ready') return []
    name = 'connections.audit-visible'
  } else {
    if (!evidence.selected || !evidence.userInitiated || !scope.sessionId) return []
    name = 'skill.selected'
  }
  return [{ name, binding: observation.binding, operationToken: observation.operationToken, operationStartedAt: observation.at, eventToken: `${observation.operationToken}:${name}`, at: Date.now(), level: 'observed', origin: 'ui-observation' }]
}

export function toggleSourceSelection(slugs: readonly string[], slug: string): string[] {
  return slugs.includes(slug) ? slugs.filter(current => current !== slug) : [...slugs, slug]
}
