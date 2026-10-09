/**
 * Named operator roles and their method-scope ceiling.
 *
 * Clean-room re-expression of OpenClaw's operator-scope ceiling
 * (port-matrix row a1.2; upstream src/shared/operator-scope-compat.ts:1,
 * src/gateway/operator-role-policy.ts:95, src/config/zod-schema.gateway.ts:82).
 *
 * The ceiling is a *scope* set resolved once per connection at WS admission by
 * intersecting a role's allowed scopes with the channel classification. Every
 * request then re-checks its channel against the persisted ceiling. LOCAL_ONLY
 * channels are never remotely reachable, independent of any role.
 *
 * Fail-closed: an unknown or missing role, a malformed definition, an empty
 * scope set, or an unclassified channel all deny.
 */

import { isLocalOnly } from '@rox/shared/protocol'
import {
  OPERATOR_SCOPES,
  type OperatorRoleCeiling,
  type OperatorRoleDefinition,
  type OperatorScope,
} from '@rox/shared/orgs/types'

/** Every scope an unrestricted (owner) connection holds. */
export const ALL_OPERATOR_SCOPES: readonly OperatorScope[] = OPERATOR_SCOPES

/** A deny-all ceiling used whenever role resolution cannot succeed. */
export const DENIED_OPERATOR_CEILING: OperatorRoleCeiling = Object.freeze({
  configured: true,
  role: null,
  scopes: Object.freeze([] as OperatorScope[]),
  accessPolicyPlugin: null,
})

const SESSION_CHANNEL_PREFIX = 'sessions:'
const MAX_AGENT_ID_LENGTH = 128
const MAX_PLUGIN_ID_LENGTH = 128

/** Static membership lookups (string-keyed tables, not dynamic sets). */
const READ_ACTIONS: Record<string, true> = { read: true, subscribe: true }
const MUTATE_ACTIONS: Record<string, true> = { write: true, delete: true }
const SESSION_OTHERS: Record<string, true> = { none: true, view: true, suggest: true, write: true }
const SANDBOX_MODES: Record<string, true> = { inherit: true, required: true }
const OPERATOR_SCOPE_LOOKUP: Record<string, true> = Object.fromEntries(
  OPERATOR_SCOPES.map((scope) => [scope, true as const]),
)

function isOperatorScope(value: unknown): value is OperatorScope {
  return typeof value === 'string' && OPERATOR_SCOPE_LOOKUP[value] === true
}

/**
 * Whether `granted` satisfies `requested`, including the operator implication
 * rules. Unknown `operator.*` scopes require an exact match unless the caller
 * already holds `operator.admin`.
 */
export function operatorScopeSatisfied(requested: string, granted: readonly string[]): boolean {
  if (typeof requested !== 'string' || !requested.startsWith('operator.')) return false
  if (granted.includes(requested) || granted.includes('operator.admin')) return true
  if (granted.includes('operator.write')) {
    return requested === 'operator.read'
      || requested === 'operator.talk'
      || requested === 'operator.sessions.read'
      || requested === 'operator.sessions.write'
  }
  if (requested === 'operator.sessions.read') {
    return granted.includes('operator.read') || granted.includes('operator.sessions.write')
  }
  return false
}

/**
 * Keep only the scopes shared by both ceilings, preserving implied operator
 * scopes (upstream `intersectOperatorScopes`).
 */
export function intersectOperatorScopeCeilings(
  scopes: readonly string[],
  ceiling: readonly string[],
): OperatorScope[] {
  if (scopes.every((scope) => operatorScopeSatisfied(scope, ceiling))) {
    return [...new Set(scopes.filter(isOperatorScope))]
  }
  const candidates = new Set<string>([...scopes, ...ceiling])
  const result: OperatorScope[] = []
  for (const scope of candidates) {
    if (isOperatorScope(scope)
      && operatorScopeSatisfied(scope, scopes)
      && operatorScopeSatisfied(scope, ceiling)) {
      result.push(scope)
    }
  }
  // General reads and session-only writes share a narrower read capability even
  // when neither input spells it out. Never add one-sided grants.
  for (const scope of ['operator.sessions.write', 'operator.sessions.read'] as const) {
    if (operatorScopeSatisfied(scope, scopes)
      && operatorScopeSatisfied(scope, ceiling)
      && !operatorScopeSatisfied(scope, result)) {
      result.push(scope)
    }
  }
  return result
}

/** True when the value contains a C0 control character or DEL, which names reject. */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function nonEmptyString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || hasControlChar(trimmed)) return null
  return trimmed
}

/**
 * Validate an untrusted role definition. Returns null for anything malformed so
 * the caller can deny instead of silently widening the ceiling.
 */
export function normalizeOperatorRoleDefinition(input: unknown): OperatorRoleDefinition | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const candidate = input as Record<string, unknown>
  if (!Array.isArray(candidate.scopes)) return null
  const scopes: OperatorScope[] = []
  for (const scope of candidate.scopes) {
    if (!isOperatorScope(scope)) return null
    if (!scopes.includes(scope)) scopes.push(scope)
  }

  const definition: {
    scopes: OperatorScope[]
    sessions?: { others: 'none' | 'view' | 'suggest' | 'write' }
    agents?: '*' | string[]
    sandbox?: 'inherit' | 'required'
    modelPolicy?: { sourceAgent?: string; allow?: string[]; deny?: string[] }
    accessPolicyPlugin?: string
  } = { scopes }

  if (candidate.sessions !== undefined) {
    if (!candidate.sessions || typeof candidate.sessions !== 'object') return null
    const others = (candidate.sessions as Record<string, unknown>).others
    if (typeof others !== 'string' || SESSION_OTHERS[others] !== true) return null
    definition.sessions = { others: others as 'none' | 'view' | 'suggest' | 'write' }
  }

  if (candidate.agents !== undefined) {
    if (candidate.agents === '*') {
      definition.agents = '*'
    } else {
      if (!Array.isArray(candidate.agents)) return null
      const agents: string[] = []
      for (const agent of candidate.agents) {
        const id = nonEmptyString(agent, MAX_AGENT_ID_LENGTH)
        if (id === null) return null
        if (!agents.includes(id)) agents.push(id)
      }
      definition.agents = agents
    }
  }

  if (candidate.sandbox !== undefined) {
    if (typeof candidate.sandbox !== 'string' || SANDBOX_MODES[candidate.sandbox] !== true) return null
    definition.sandbox = candidate.sandbox as 'inherit' | 'required'
  }

  if (candidate.modelPolicy !== undefined) {
    if (!candidate.modelPolicy || typeof candidate.modelPolicy !== 'object') return null
    const policy = candidate.modelPolicy as Record<string, unknown>
    const modelPolicy: { sourceAgent?: string; allow?: string[]; deny?: string[] } = {}
    if (policy.sourceAgent !== undefined) {
      const source = nonEmptyString(policy.sourceAgent, MAX_AGENT_ID_LENGTH)
      if (source === null) return null
      modelPolicy.sourceAgent = source
    }
    for (const key of ['allow', 'deny'] as const) {
      if (policy[key] === undefined) continue
      if (!Array.isArray(policy[key])) return null
      const values: string[] = []
      for (const entry of policy[key] as unknown[]) {
        const value = nonEmptyString(entry, MAX_AGENT_ID_LENGTH)
        if (value === null) return null
        if (!values.includes(value)) values.push(value)
      }
      modelPolicy[key] = values
    }
    definition.modelPolicy = modelPolicy
  }

  if (candidate.accessPolicyPlugin !== undefined) {
    const plugin = nonEmptyString(candidate.accessPolicyPlugin, MAX_PLUGIN_ID_LENGTH)
    if (plugin === null) return null
    definition.accessPolicyPlugin = plugin
  }

  return Object.freeze(definition)
}

export interface OperatorRoleRegistry {
  readonly definitions: Readonly<Record<string, unknown>>
  readonly default?: string | null
}

/**
 * Resolve a connection's named-role ceiling, fail-closed.
 *
 * - No definitions and no default => no boundary (`configured:false`).
 * - Known role name => its scopes.
 * - Unknown/missing name with a valid default => the default's scopes.
 * - Anything else => deny-all.
 */
export function resolveOperatorRoleCeiling(
  registry: OperatorRoleRegistry,
  roleName: string | null | undefined,
): OperatorRoleCeiling {
  const hasDefinitions = Object.keys(registry.definitions ?? {}).length > 0
  const defaultName = typeof registry.default === 'string' && registry.default.trim() ? registry.default.trim() : null
  if (!hasDefinitions && !defaultName) {
    return Object.freeze({ configured: false, role: null, scopes: ALL_OPERATOR_SCOPES, accessPolicyPlugin: null })
  }
  const requested = typeof roleName === 'string' && roleName.trim() ? roleName.trim() : null
  const definition = resolveDefinition(registry, requested) ?? resolveDefinition(registry, defaultName)
  if (!definition) return DENIED_OPERATOR_CEILING
  return Object.freeze({
    configured: true,
    role: definition.name,
    scopes: Object.freeze([...definition.scopes]),
    accessPolicyPlugin: definition.accessPolicyPlugin,
  })
}

function resolveDefinition(
  registry: OperatorRoleRegistry,
  name: string | null,
): { name: string; scopes: OperatorScope[]; accessPolicyPlugin: string | null } | null {
  if (!name) return null
  if (!Object.hasOwn(registry.definitions, name)) return null
  const normalized = normalizeOperatorRoleDefinition(registry.definitions[name])
  if (!normalized) return null
  return { name, scopes: [...normalized.scopes], accessPolicyPlugin: normalized.accessPolicyPlugin ?? null }
}

// ---------------------------------------------------------------------------
// Channel classification
// ---------------------------------------------------------------------------

export interface OperatorChannelRequirement {
  /** False for LOCAL_ONLY channels: never remotely reachable by any role. */
  readonly remote: boolean
  /** Required scope; null means unclassified and therefore denied. */
  readonly scope: OperatorScope | null
}

/**
 * Classify a channel into the scope it requires. LOCAL_ONLY channels are
 * unreachable remotely regardless of role. Session channels map to the
 * session-scoped operator scopes, everything else to the general ones.
 */
export function classifyOperatorChannel(
  channel: string,
  nativeAction: string | undefined,
): OperatorChannelRequirement {
  if (typeof channel !== 'string' || channel.length === 0) return { remote: false, scope: null }
  if (isLocalOnly(channel)) return { remote: false, scope: null }
  const sessionScoped = channel.startsWith(SESSION_CHANNEL_PREFIX)
  if (typeof nativeAction === 'string' && READ_ACTIONS[nativeAction] === true) {
    return { remote: true, scope: sessionScoped ? 'operator.sessions.read' : 'operator.read' }
  }
  if (typeof nativeAction === 'string' && MUTATE_ACTIONS[nativeAction] === true) {
    return { remote: true, scope: sessionScoped ? 'operator.sessions.write' : 'operator.write' }
  }
  return { remote: true, scope: null }
}

/**
 * Whether the connection's persisted ceiling permits `channel`.
 *
 * `configured:false` returns true for classified channels so existing
 * grant-based authority is unchanged when no named roles are ever configured.
 * LOCAL_ONLY and unclassified channels always deny, independent of whether a
 * ceiling is configured.
 */
export function isChannelWithinOperatorCeiling(
  ceiling: OperatorRoleCeiling | null | undefined,
  channel: string,
  nativeAction: string | undefined,
): boolean {
  if (!ceiling) return false
  const requirement = classifyOperatorChannel(channel, nativeAction)
  if (!requirement.remote || requirement.scope === null) return false
  // An unconfigured ceiling preserves legacy grant authority for ordinary
  // channels, but it must never reopen the LOCAL_ONLY refusal above.
  if (!ceiling.configured) return true
  return operatorScopeSatisfied(requirement.scope, ceiling.scopes)
}