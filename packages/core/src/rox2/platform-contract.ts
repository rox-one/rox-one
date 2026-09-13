/**
 * ROX2 unified entity / relation / permission / event / result / context contract.
 *
 * This is the typed seam between native Rox surfaces and Conation data-plane
 * adapters. It does not perform I/O. Conation Soup/DSS clients stay read-only
 * until a later card lands writes behind permission + budget gates.
 *
 * Live vs queued/simulated/fixture is explicit: callers must not treat a
 * non-live result as a completed product action (issue #315).
 * `state: 'live'` is an execution mode, not proof the action succeeded or was
 * verified (issue #325 / #342) — canvas runners must not copy this as `done`.
 */

import type { SoupEntityConcreteType } from '../conation/soup/types.ts'

export const ROX2_ENTITY_KINDS = [
  'session',
  'note',
  'task',
  'project',
  'page',
  'memory',
  'skill',
  'source',
  'automation',
  'connection',
  'file',
  'mail-thread',
  'calendar-event',
  'crm-company',
  'channel',
  'channel-message',
  'call',
  'meeting',
  'reminder',
  'workflow',
  'person',
  'outcome',
] as const

export type Rox2EntityKind = (typeof ROX2_ENTITY_KINDS)[number]

export const ROX2_RELATION_KINDS = [
  'parent',
  'mentions',
  'blocks',
  'assigned',
  'in-calendar',
  'derived-from',
  'attached-to',
  'membership',
  'depends-on',
  'discusses',
  'produces',
  'replaces',
] as const

export type Rox2RelationKind = (typeof ROX2_RELATION_KINDS)[number]

export const ROX2_PERMISSIONS = [
  'read',
  'write',
  'share',
  'publish',
  'spend',
  'destroy',
  'device-read',
  'cloud-send',
] as const

export type Rox2Permission = (typeof ROX2_PERMISSIONS)[number]

export const ROX2_RUN_STATES = [
  'live',
  'queued',
  'simulated',
  'fixture',
  'documented',
] as const

export type Rox2RunState = (typeof ROX2_RUN_STATES)[number]

export type Rox2EntitySource = 'native' | 'conation' | 'hybrid'

/** Stable identity across rename / import / restart. `entityId` is local, never the remote id. */
export type Rox2EntityRef = {
  workspaceId: string
  entityId: string
  revisionId: string
}

export type Rox2ExternalBinding = {
  provider: string
  account: string
  remoteType: string
  remoteId: string
}

export type Rox2Entity = {
  id: string
  kind: Rox2EntityKind
  displayName: string
  workspaceId: string
  source: Rox2EntitySource
  permissions: readonly Rox2Permission[]
  updatedAt: number
  ref?: Rox2EntityRef
  binding?: Rox2ExternalBinding
}

export type Rox2Relation = {
  fromId: string
  toId: string
  kind: Rox2RelationKind
  domain?: Rox2EntityKind
  range?: Rox2EntityKind
}

export type Rox2Event = {
  id: string
  entityId: string
  type: string
  at: number
  actor: string
  payload?: Record<string, unknown>
}

export type Rox2Selection = {
  blockIds?: readonly string[]
  text?: string
  filter?: string
}

export type Rox2Context = {
  workspaceId: string
  sessionId?: string
  surfaceId?: string
  entityRefs: readonly string[]
  permissionMode: 'allow-all' | 'ask' | 'safe'
  /** Source revision per namespaced entity ref. */
  revisions?: Readonly<Record<string, string>>
  selection?: Rox2Selection
  snapshotBudgetTokens?: number
}

export type Rox2OkResult = {
  ok: true
  state: 'live'
  entityId: string
}

export type Rox2ErrResult = {
  ok: false
  state: Exclude<Rox2RunState, 'live'>
  code: string
  message: string
}

export type Rox2Result = Rox2OkResult | Rox2ErrResult

export const ROX2_LIFECYCLES = ['accepted', 'applied', 'failed', 'rejected'] as const
export type Rox2Lifecycle = (typeof ROX2_LIFECYCLES)[number]

export const ROX2_VERIFICATIONS = ['verified', 'unknown', 'unverified'] as const
export type Rox2Verification = (typeof ROX2_VERIFICATIONS)[number]

/**
 * V2 result: execution mode is not proof. Legacy `{ ok, state: 'live' }`
 * decodes as verification `unknown` and must not be promoted to verified.
 */
export type Rox2V2Result = {
  ok: boolean
  mode: Rox2RunState
  lifecycle: Rox2Lifecycle
  verification: Rox2Verification
  entityId?: string
  code?: string
  message?: string
}

const SOUP_TO_ROX2: Record<SoupEntityConcreteType, Rox2EntityKind> = {
  GraphqlSoupDocument: 'note',
  GraphqlSoupChat: 'session',
  GraphqlSoupProject: 'project',
  GraphqlSoupEmailThread: 'mail-thread',
  GraphqlSoupChannel: 'channel',
  GraphqlSoupChannelMessage: 'channel-message',
  GraphqlSoupCall: 'call',
  GraphqlSoupCalendarEvent: 'calendar-event',
  GraphqlSoupCrmCompany: 'crm-company',
  GraphqlSoupForeignEntity: 'source',
  GraphqlSoupReminder: 'reminder',
}

export function soupTypeToRox2Kind(type: SoupEntityConcreteType): Rox2EntityKind {
  return SOUP_TO_ROX2[type]
}

export function isRox2EntityKind(value: string): value is Rox2EntityKind {
  return (ROX2_ENTITY_KINDS as readonly string[]).includes(value)
}

export function formatRox2EntityId(kind: Rox2EntityKind, id: string): string {
  if (!id) throw new Error('Rox2 entity id is empty')
  return `${kind}:${id}`
}

export function parseRox2EntityId(ref: string): { kind: Rox2EntityKind; id: string } {
  const sep = ref.indexOf(':')
  if (sep <= 0) throw new Error(`Invalid Rox2 entity ref: ${ref}`)
  const kind = ref.slice(0, sep)
  const id = ref.slice(sep + 1)
  if (!isRox2EntityKind(kind) || !id) throw new Error(`Invalid Rox2 entity ref: ${ref}`)
  return { kind, id }
}

export function formatRox2EntityRef(kind: Rox2EntityKind, ref: Rox2EntityRef): string {
  if (!ref.workspaceId || !ref.entityId || !ref.revisionId) {
    throw new Error('Rox2 entity ref is incomplete')
  }
  return `${kind}:${ref.workspaceId}:${ref.entityId}@${ref.revisionId}`
}

export function parseRox2EntityRef(ref: string): { kind: Rox2EntityKind; ref: Rox2EntityRef } {
  const match = /^([^:]+):([^:]+):([^@]+)@(.+)$/.exec(ref)
  if (!match) throw new Error(`Invalid Rox2 namespaced entity ref: ${ref}`)
  const kind = match[1]!
  if (!isRox2EntityKind(kind)) throw new Error(`Invalid Rox2 entity ref: ${ref}`)
  return {
    kind,
    ref: { workspaceId: match[2]!, entityId: match[3]!, revisionId: match[4]! },
  }
}

export function externalBindingKey(binding: Rox2ExternalBinding): string {
  if (!binding.provider || !binding.account || !binding.remoteType || !binding.remoteId) {
    throw new Error('Rox2 external binding is incomplete')
  }
  return `${binding.provider}\0${binding.account}\0${binding.remoteType}\0${binding.remoteId}`
}

/** Only `live` may be presented as a completed product action. Not proof of success. */
export function isClaimableLive(result: Rox2Result): result is Rox2OkResult {
  return result.ok === true && result.state === 'live'
}

export function isRox2RunState(value: unknown): value is Rox2RunState {
  return typeof value === 'string' && (ROX2_RUN_STATES as readonly string[]).includes(value)
}

export function isRox2Lifecycle(value: unknown): value is Rox2Lifecycle {
  return typeof value === 'string' && (ROX2_LIFECYCLES as readonly string[]).includes(value)
}

export function isRox2Verification(value: unknown): value is Rox2Verification {
  return typeof value === 'string' && (ROX2_VERIFICATIONS as readonly string[]).includes(value)
}

export function decodeRox2V2Result(raw: unknown): Rox2V2Result {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Rox2 result')
  }
  const obj = raw as Record<string, unknown>
  if ('mode' in obj || 'lifecycle' in obj || 'verification' in obj) {
    if (!isRox2RunState(obj.mode) || !isRox2Lifecycle(obj.lifecycle) || !isRox2Verification(obj.verification)) {
      throw new Error('Invalid Rox2 V2 result')
    }
    if (obj.verification === 'verified' && (obj.ok !== true || obj.mode !== 'live' || obj.lifecycle !== 'applied')) {
      throw new Error('Verified Rox2 result requires live applied success')
    }
    return {
      ok: obj.ok === true,
      mode: obj.mode,
      lifecycle: obj.lifecycle,
      verification: obj.verification,
      entityId: typeof obj.entityId === 'string' ? obj.entityId : undefined,
      code: typeof obj.code === 'string' ? obj.code : undefined,
      message: typeof obj.message === 'string' ? obj.message : undefined,
    }
  }
  if (obj.ok === true && obj.state === 'live') {
    return {
      ok: true,
      mode: 'live',
      lifecycle: 'applied',
      verification: 'unknown',
      entityId: typeof obj.entityId === 'string' ? obj.entityId : undefined,
    }
  }
  if (obj.ok === false && isRox2RunState(obj.state) && obj.state !== 'live') {
    return {
      ok: false,
      mode: obj.state,
      lifecycle: 'failed',
      verification: 'unverified',
      code: typeof obj.code === 'string' ? obj.code : 'error',
      message: typeof obj.message === 'string' ? obj.message : '',
    }
  }
  throw new Error('Invalid Rox2 result')
}

export function isVerifiedEffect(result: Rox2V2Result): boolean {
  return result.ok === true
    && result.mode === 'live'
    && result.lifecycle === 'applied'
    && result.verification === 'verified'
}

export function queuedResult(code: string, message: string): Rox2ErrResult {
  return { ok: false, state: 'queued', code, message }
}

export function fixtureResult(code: string, message: string): Rox2ErrResult {
  return { ok: false, state: 'fixture', code, message }
}

export function simulatedResult(code: string, message: string): Rox2ErrResult {
  return { ok: false, state: 'simulated', code, message }
}

export const SENSITIVE_PERMISSIONS: readonly Rox2Permission[] = [
  'device-read',
  'cloud-send',
  'share',
  'publish',
  'spend',
  'destroy',
]

export function requiresExplicitGrant(permission: Rox2Permission): boolean {
  return (SENSITIVE_PERMISSIONS as readonly string[]).includes(permission)
}

export const ROX2_RELATION_CONSTRAINTS: Record<Rox2RelationKind, { domain: readonly Rox2EntityKind[]; range: readonly Rox2EntityKind[] }> = {
  parent: {
    domain: ROX2_ENTITY_KINDS,
    range: ROX2_ENTITY_KINDS,
  },
  mentions: {
    domain: ['session', 'note', 'task', 'workflow', 'outcome', 'meeting', 'call'],
    range: ['session', 'note', 'task', 'person', 'crm-company', 'file', 'calendar-event', 'workflow', 'meeting', 'call'],
  },
  blocks: {
    domain: ['task', 'workflow', 'outcome'],
    range: ['task', 'workflow', 'outcome'],
  },
  assigned: {
    domain: ['task', 'workflow', 'session', 'calendar-event', 'meeting'],
    range: ['person'],
  },
  'in-calendar': {
    domain: ['task', 'session', 'outcome', 'reminder'],
    range: ['calendar-event'],
  },
  'derived-from': {
    domain: ['note', 'outcome', 'workflow', 'file', 'session', 'meeting'],
    range: ['session', 'note', 'file', 'workflow', 'outcome', 'meeting', 'call'],
  },
  'attached-to': {
    domain: ['file', 'note'],
    range: ['session', 'note', 'task', 'project', 'workflow', 'person', 'crm-company'],
  },
  membership: {
    domain: ['session', 'note', 'task', 'file', 'workflow', 'outcome', 'calendar-event', 'meeting', 'call'],
    range: ['project'],
  },
  'depends-on': {
    domain: ['task', 'workflow', 'outcome'],
    range: ['task', 'workflow', 'outcome'],
  },
  discusses: {
    domain: ['note', 'session', 'channel-message', 'meeting'],
    range: ['person', 'crm-company', 'note', 'session', 'task', 'meeting'],
  },
  produces: {
    domain: ['session', 'note', 'workflow', 'task', 'meeting'],
    range: ['outcome', 'file', 'note'],
  },
  replaces: {
    domain: ['note', 'task', 'workflow', 'file', 'outcome'],
    range: ['note', 'task', 'workflow', 'file', 'outcome'],
  },
}

/** Directed kinds that must stay a DAG. Mutual mentions/discusses stay allowed. */
export const ROX2_ACYCLIC_RELATION_KINDS = ['blocks', 'depends-on', 'replaces', 'parent'] as const

export type Rox2AcyclicRelationKind = (typeof ROX2_ACYCLIC_RELATION_KINDS)[number]

export const ROX2_RELATION_DELETION_POLICY: Record<Rox2RelationKind, 'cascade' | 'restrict' | 'detach'> = {
  parent: 'detach',
  mentions: 'detach',
  blocks: 'detach',
  assigned: 'detach',
  'in-calendar': 'detach',
  'derived-from': 'detach',
  'attached-to': 'detach',
  membership: 'detach',
  'depends-on': 'detach',
  discusses: 'detach',
  produces: 'detach',
  replaces: 'detach',
}

export function isAcyclicRelationKind(kind: Rox2RelationKind): kind is Rox2AcyclicRelationKind {
  return (ROX2_ACYCLIC_RELATION_KINDS as readonly string[]).includes(kind)
}

export function assertRelationKinds(
  relation: Pick<Rox2Relation, 'kind' | 'domain' | 'range'>,
  fromKind: Rox2EntityKind,
  toKind: Rox2EntityKind,
): void {
  const constraint = ROX2_RELATION_CONSTRAINTS[relation.kind]
  if (!constraint.domain.includes(fromKind)) {
    throw new Error(`Relation ${relation.kind} does not allow domain ${fromKind}`)
  }
  if (!constraint.range.includes(toKind)) {
    throw new Error(`Relation ${relation.kind} does not allow range ${toKind}`)
  }
  if (relation.domain && relation.domain !== fromKind) {
    throw new Error(`Relation domain ${relation.domain} does not match ${fromKind}`)
  }
  if (relation.range && relation.range !== toKind) {
    throw new Error(`Relation range ${relation.range} does not match ${toKind}`)
  }
}
