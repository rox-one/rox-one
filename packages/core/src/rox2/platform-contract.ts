/**
 * ROX2 unified entity / relation / permission / event / result / context contract.
 *
 * This is the typed seam between native Rox surfaces and Conation data-plane
 * adapters. It does not perform I/O. Conation Soup/DSS clients stay read-only
 * until a later card lands writes behind permission + budget gates.
 *
 * Status is a triad, not a single overloaded run state (ROX-P0-CONTRACT-STATUS-SPLIT):
 * executionMode × lifecycle × verification. `isClaimableLive` is live + succeeded +
 * policy-verified. queued is not an error. live+failed is not success. Succeeded
 * without a receipt stays unverified. Legacy `Rox2RunState` remains as a compat alias.
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
  'member-of',
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

export const ROX2_EXECUTION_MODES = ['live', 'fixture', 'simulated'] as const
export type Rox2ExecutionMode = (typeof ROX2_EXECUTION_MODES)[number]

export const ROX2_LIFECYCLES = [
  'queued',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
] as const
export type Rox2Lifecycle = (typeof ROX2_LIFECYCLES)[number]

export const ROX2_VERIFICATIONS = ['unverified', 'receipt_verified', 'readback_verified'] as const
export type Rox2Verification = (typeof ROX2_VERIFICATIONS)[number]

export type Rox2VerificationPolicy = 'receipt' | 'readback' | 'any'

/** @deprecated Overload of executionMode/lifecycle/verification. Adapter maps this to the triad. */
export const ROX2_RUN_STATES = [
  'live',
  'queued',
  'simulated',
  'fixture',
  'documented',
] as const

/** @deprecated Prefer Rox2ExecutionMode, Rox2Lifecycle, and Rox2Verification. */
export type Rox2RunState = (typeof ROX2_RUN_STATES)[number]

export type Rox2Receipt = {
  provider?: string
  remoteId?: string
  requestId?: string
  observedRevision?: string
  verifiedAt?: string
}

export type Rox2Status = {
  executionMode: Rox2ExecutionMode
  lifecycle: Rox2Lifecycle
  verification: Rox2Verification
}

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
  causationId?: string
  correlationId?: string
  aggregateRevision?: string
}

export type Rox2Context = {
  workspaceId: string
  sessionId?: string
  surfaceId?: string
  entityRefs: readonly string[]
  permissionMode: 'allow-all' | 'ask' | 'safe'
  binding?: {
    snapshotPolicy: 'snapshot' | 'live'
    revisionByEntityId: Record<string, string>
    selection?: { surfaceId: string; blockIds?: readonly string[] }
    tokenEstimate?: number
    acceptedOutcomeIds?: readonly string[]
  }
}

export type Rox2CanonicalResult = Rox2Status & {
  entityId?: string
  receipt?: Rox2Receipt
  code?: string
  message?: string
  /** Derived from lifecycle: failed/cancelled are false. queued is not false. */
  ok?: boolean
  /** @deprecated Compat projection of the triad. */
  state?: Rox2RunState
}

/** @deprecated Prefer a canonical triad result. Kept so `{ ok, state: 'live' }` still type-checks. */
export type Rox2LegacyOkResult = {
  ok: true
  state: 'live'
  entityId: string
}

/** @deprecated Prefer a canonical triad result. Kept so queued/fixture/simulated objects still type-check. */
export type Rox2LegacyErrResult = {
  ok: false
  state: Exclude<Rox2RunState, 'live'>
  code: string
  message: string
}

export type Rox2OkResult =
  | Rox2LegacyOkResult
  | (Rox2CanonicalResult & {
      ok: true
      executionMode: 'live'
      lifecycle: 'succeeded'
      verification: 'receipt_verified' | 'readback_verified'
      entityId: string
    })

export type Rox2ErrResult = Rox2LegacyErrResult | (Rox2CanonicalResult & { ok: false })

export type Rox2Result = Rox2CanonicalResult | Rox2LegacyOkResult | Rox2LegacyErrResult

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

/** Workspace-scoped identity with an optional revision. Not a second entity store. */
export type Rox2EntityRef = {
  workspaceId: string
  entityId: string
  revisionId?: string
  /** Remote-account namespace. Distinct from workspaceId. */
  accountNamespace?: string
}

export type Rox2ExternalBinding = {
  provider: string
  account: string
  remoteType: string
  remoteId: string
}

export type Rox2BindingRegisterResult =
  | { status: 'ok'; ref: Rox2EntityRef }
  | { status: 'quarantine'; reason: string; existing: Rox2EntityRef }

/**
 * Binding key format (v1 writes):
 *   encodeURIComponent(provider) + ':' + encodeURIComponent(account)
 *     + ':' + encodeURIComponent(remoteType) + ':' + encodeURIComponent(remoteId)
 *
 * Exactly four slots. `:` `%` and other encodeURIComponent reserved characters
 * inside a field cannot shift slots. Round-trip is format → parse.
 *
 * Reads: reject-closed unless the key has exactly four slots and each slot
 * decodes via decodeURIComponent to a non-empty string. Ambiguous legacy keys that
 * concatenated unencoded fields (five or more `:`-split segments, e.g.
 * `g:ac:ct:event:1` for account `ac:ct`) are rejected — they are not migrated.
 * Four-slot keys with only unreserved characters still decode (identity), so
 * simple historical keys such as `google:work:event:e1` remain readable.
 * Invalid percent-encoding is rejected. New writes always emit encoded slots.
 */
const BINDING_KEY_SLOT_COUNT = 4

function encodeBindingSlot(value: string): string {
  return encodeURIComponent(value)
}

function decodeBindingSlot(slot: string, key: string): string {
  if (!slot) throw new Error(`Invalid external binding key: ${key}`)
  let decoded: string
  try {
    decoded = decodeURIComponent(slot)
  } catch {
    throw new Error(`Invalid external binding key: ${key}`)
  }
  if (!decoded) throw new Error(`Invalid external binding key: ${key}`)
  return decoded
}

export function formatRox2ExternalBindingKey(binding: Rox2ExternalBinding): string {
  if (!binding.provider || !binding.account || !binding.remoteType || !binding.remoteId) {
    throw new Error('incomplete external binding')
  }
  return [
    encodeBindingSlot(binding.provider),
    encodeBindingSlot(binding.account),
    encodeBindingSlot(binding.remoteType),
    encodeBindingSlot(binding.remoteId),
  ].join(':')
}

export function parseRox2ExternalBindingKey(key: string): Rox2ExternalBinding {
  const parts = key.split(':')
  if (parts.length !== BINDING_KEY_SLOT_COUNT) {
    throw new Error(`Invalid external binding key: ${key}`)
  }
  return {
    provider: decodeBindingSlot(parts[0] ?? '', key),
    account: decodeBindingSlot(parts[1] ?? '', key),
    remoteType: decodeBindingSlot(parts[2] ?? '', key),
    remoteId: decodeBindingSlot(parts[3] ?? '', key),
  }
}

export function entityRefFromBinding(
  workspaceId: string,
  kind: Rox2EntityKind,
  binding: Rox2ExternalBinding,
  revisionId?: string,
): Rox2EntityRef {
  if (!workspaceId) throw new Error('workspace id is empty')
  return {
    workspaceId,
    entityId: formatRox2EntityId(kind, formatRox2ExternalBindingKey(binding)),
    revisionId,
    accountNamespace: binding.account,
  }
}

/** Re-import of the same remote key is stable. Colliding keys and workspace mismatches quarantine. */
export function registerExternalBinding(
  index: Map<string, Rox2EntityRef>,
  workspaceId: string,
  kind: Rox2EntityKind,
  binding: Rox2ExternalBinding,
  revisionId?: string,
): Rox2BindingRegisterResult {
  const key = formatRox2ExternalBindingKey(binding)
  const ref = entityRefFromBinding(workspaceId, kind, binding, revisionId)
  const existing = index.get(key)
  if (existing && existing.workspaceId !== workspaceId) {
    return { status: 'quarantine', reason: 'workspace-mismatch', existing }
  }
  if (existing && existing.entityId !== ref.entityId) {
    return { status: 'quarantine', reason: 'binding-collision', existing }
  }
  if (existing) {
    const next: Rox2EntityRef = {
      ...existing,
      revisionId: revisionId ?? existing.revisionId,
    }
    index.set(key, next)
    return { status: 'ok', ref: next }
  }
  index.set(key, ref)
  return { status: 'ok', ref }
}

export type Rox2RelationRule = {
  domain: readonly Rox2EntityKind[] | '*'
  range: readonly Rox2EntityKind[] | '*'
  cyclic: boolean
  deletion: 'clear-edge' | 'restrict'
}

export const ROX2_RELATION_RULES: Record<Rox2RelationKind, Rox2RelationRule> = {
  parent: { domain: '*', range: '*', cyclic: false, deletion: 'clear-edge' },
  mentions: { domain: '*', range: '*', cyclic: true, deletion: 'clear-edge' },
  blocks: { domain: ['task'], range: ['task'], cyclic: false, deletion: 'restrict' },
  assigned: { domain: ['task', 'session', 'note'], range: ['person'], cyclic: false, deletion: 'clear-edge' },
  'in-calendar': { domain: '*', range: ['calendar-event'], cyclic: false, deletion: 'clear-edge' },
  'derived-from': { domain: '*', range: '*', cyclic: false, deletion: 'clear-edge' },
  'attached-to': { domain: ['file', 'note'], range: '*', cyclic: true, deletion: 'clear-edge' },
  'member-of': { domain: ['session', 'note', 'task'], range: ['project'], cyclic: false, deletion: 'clear-edge' },
}

function kindMatches(allowed: readonly Rox2EntityKind[] | '*', kind: Rox2EntityKind): boolean {
  return allowed === '*' || allowed.includes(kind)
}

export function isAllowedRox2Relation(
  kind: Rox2RelationKind,
  fromKind: Rox2EntityKind,
  toKind: Rox2EntityKind,
): boolean {
  const rule = ROX2_RELATION_RULES[kind]
  return kindMatches(rule.domain, fromKind) && kindMatches(rule.range, toKind)
}

export function wouldCreateRelationCycle(
  kind: Rox2RelationKind,
  edges: readonly Rox2Relation[],
  fromId: string,
  toId: string,
): boolean {
  if (ROX2_RELATION_RULES[kind].cyclic) return false
  if (fromId === toId) return true
  const outbound = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== kind) continue
    const list = outbound.get(edge.fromId) ?? []
    list.push(edge.toId)
    outbound.set(edge.fromId, list)
  }
  const pending = [toId]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || seen.has(current)) continue
    if (current === fromId) return true
    seen.add(current)
    for (const next of outbound.get(current) ?? []) pending.push(next)
  }
  return false
}

function isCanonicalResult(result: Rox2Result): result is Rox2CanonicalResult {
  return 'executionMode' in result && 'lifecycle' in result && 'verification' in result
}

function derivedOk(status: Rox2Status): boolean {
  return status.lifecycle !== 'failed' && status.lifecycle !== 'cancelled'
}

function projectRunState(status: Rox2Status): Rox2RunState {
  if (status.executionMode === 'fixture') return 'fixture'
  if (status.executionMode === 'simulated') return 'simulated'
  if (status.lifecycle === 'queued') return 'queued'
  return 'live'
}

function legacyRunStateToStatus(state: Rox2RunState): Rox2Status {
  switch (state) {
    case 'live':
      return { executionMode: 'live', lifecycle: 'succeeded', verification: 'unverified' }
    case 'queued':
      return { executionMode: 'live', lifecycle: 'queued', verification: 'unverified' }
    case 'simulated':
      return { executionMode: 'simulated', lifecycle: 'succeeded', verification: 'unverified' }
    case 'fixture':
      return { executionMode: 'fixture', lifecycle: 'succeeded', verification: 'unverified' }
    case 'documented':
      return { executionMode: 'simulated', lifecycle: 'succeeded', verification: 'unverified' }
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function withStatusFields(status: Rox2Status, extra: Omit<Rox2CanonicalResult, keyof Rox2Status | 'ok' | 'state'>): Rox2CanonicalResult {
  return {
    ...status,
    ...extra,
    ok: derivedOk(status),
    state: projectRunState(status),
  }
}

function isPolicyVerified(
  verification: Rox2Verification,
  policy: Rox2VerificationPolicy = 'any',
): boolean {
  if (verification === 'unverified') return false
  if (policy === 'receipt') return verification === 'receipt_verified'
  if (policy === 'readback') return verification === 'readback_verified'
  return verification === 'receipt_verified' || verification === 'readback_verified'
}

/** Map a legacy `{ ok, state }` object or a canonical triad result onto the triad. */
export function normalizeRox2Result(result: Rox2Result): Rox2CanonicalResult {
  if (isCanonicalResult(result)) {
    return withStatusFields(result, {
      entityId: result.entityId,
      receipt: result.receipt,
      code: result.code,
      message: result.message,
    })
  }
  if (result.ok) {
    return withStatusFields(legacyRunStateToStatus(result.state), { entityId: result.entityId })
  }
  return withStatusFields(legacyRunStateToStatus(result.state), {
    code: result.code,
    message: result.message,
  })
}

export function liveResult(input: {
  entityId: string
  lifecycle?: Rox2Lifecycle
  verification?: Rox2Verification
  receipt?: Rox2Receipt
  code?: string
  message?: string
}): Rox2CanonicalResult {
  const lifecycle = input.lifecycle ?? 'succeeded'
  return withStatusFields(
    {
      executionMode: 'live',
      lifecycle,
      verification: input.verification ?? 'unverified',
    },
    {
      entityId: input.entityId,
      receipt: input.receipt,
      code: input.code,
      message: input.message,
    },
  )
}

/** live + succeeded + policy-verified. Legacy `{ ok, state: 'live' }` stays claimable. */
export function isClaimableLive(
  result: Rox2Result,
  policy: Rox2VerificationPolicy = 'any',
): result is Rox2OkResult {
  if (!isCanonicalResult(result)) {
    return result.ok === true && result.state === 'live'
  }
  const status = normalizeRox2Result(result)
  return (
    status.executionMode === 'live' &&
    status.lifecycle === 'succeeded' &&
    isPolicyVerified(status.verification, policy) &&
    typeof status.entityId === 'string' &&
    status.entityId.length > 0
  )
}

export function isRox2Error(result: Rox2Result): boolean {
  return normalizeRox2Result(result).lifecycle === 'failed'
}

export function queuedResult(code: string, message: string): Rox2CanonicalResult {
  return withStatusFields(
    { executionMode: 'live', lifecycle: 'queued', verification: 'unverified' },
    { code, message },
  )
}

export function fixtureResult(code: string, message: string): Rox2CanonicalResult {
  return withStatusFields(
    { executionMode: 'fixture', lifecycle: 'succeeded', verification: 'unverified' },
    { code, message },
  )
}

export function simulatedResult(code: string, message: string): Rox2CanonicalResult {
  return withStatusFields(
    { executionMode: 'simulated', lifecycle: 'succeeded', verification: 'unverified' },
    { code, message },
  )
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

export type Rox2ActorGrant = {
  actorId: string
  permission: Rox2Permission
}

/**
 * Entity.permissions is a capability catalog, not actor-scoped authorization.
 * Missing actor or grant always denies.
 */
export function authorizeRox2Action(input: {
  actorId: string | undefined
  grants: readonly Rox2ActorGrant[]
  permission: Rox2Permission
}): boolean {
  if (!input.actorId) return false
  return input.grants.some(
    (grant) => grant.actorId === input.actorId && grant.permission === input.permission,
  )
}

/** Mutating lineage needs both a revision and an account namespace. */
export function isRevisionedEntityRef(ref: Rox2EntityRef): boolean {
  return Boolean(ref.revisionId && ref.accountNamespace)
}

/** Product-audit events require causation, correlation, and aggregate revision. */
export function isAuditableRox2Event(event: Rox2Event): boolean {
  return Boolean(event.causationId && event.correlationId && event.aggregateRevision)
}

export const ROX2_SCHEMA_VERSION = 1

export type Rox2SystemFields = {
  id: string
  workspaceId: string
  displayName: string
  updatedAt: number
}

export type Rox2TypedRecord = {
  schemaVersion: number
  kind: Rox2EntityKind
  system: Rox2SystemFields
  properties: Record<string, unknown>
  unknownFields?: Record<string, unknown>
}

export type Rox2TypedParseResult =
  | { ok: true; record: Rox2TypedRecord }
  | { ok: false; code: 'unsupported-version' | 'invalid'; preserved: unknown }

function isSystemFields(value: unknown): value is Rox2SystemFields {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.workspaceId === 'string' &&
    record.workspaceId.length > 0 &&
    typeof record.displayName === 'string' &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  )
}

/** Versioned entity envelope. Unknown versions keep the original payload. */
export function parseRox2TypedRecord(raw: unknown): Rox2TypedParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'invalid', preserved: raw }
  const record = raw as Record<string, unknown>
  const version = record.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'invalid', preserved: raw }
  }
  if (version > ROX2_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported-version', preserved: raw }
  }
  if (typeof record.kind !== 'string' || !isRox2EntityKind(record.kind)) {
    return { ok: false, code: 'invalid', preserved: raw }
  }
  if (!isSystemFields(record.system)) return { ok: false, code: 'invalid', preserved: raw }
  const properties =
    record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : {}
  const unknownFields =
    record.unknownFields && typeof record.unknownFields === 'object' && !Array.isArray(record.unknownFields)
      ? (record.unknownFields as Record<string, unknown>)
      : undefined
  return {
    ok: true,
    record: {
      schemaVersion: version,
      kind: record.kind,
      system: record.system,
      properties,
      unknownFields,
    },
  }
}
