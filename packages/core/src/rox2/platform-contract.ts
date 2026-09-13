/**
 * ROX2 unified entity / relation / permission / event / result / context contract.
 *
 * This is the typed seam between native Rox surfaces and Conation data-plane
 * adapters. It does not perform I/O. Conation Soup/DSS clients stay read-only
 * until a later card lands writes behind permission + budget gates.
 *
 * Live vs queued/simulated/fixture is explicit: callers must not treat a
 * non-live result as a completed product action (issue #315).
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
  'reminder',
  'workflow',
  'person',
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

export type Rox2Entity = {
  id: string
  kind: Rox2EntityKind
  displayName: string
  workspaceId: string
  source: Rox2EntitySource
  permissions: readonly Rox2Permission[]
  updatedAt: number
}

export type Rox2Relation = {
  fromId: string
  toId: string
  kind: Rox2RelationKind
}

export type Rox2Event = {
  id: string
  entityId: string
  type: string
  at: number
  actor: string
  payload?: Record<string, unknown>
}

export type Rox2Context = {
  workspaceId: string
  sessionId?: string
  surfaceId?: string
  entityRefs: readonly string[]
  permissionMode: 'allow-all' | 'ask' | 'safe'
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

/** Only `live` may be presented as a completed product action. */
export function isClaimableLive(result: Rox2Result): result is Rox2OkResult {
  return result.ok === true && result.state === 'live'
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
