/**
 * W1-06 (#1503) — Op combinators for reference handlers (create / update /
 * transition / delete / child rows / association rows / links).
 */

import { normalizeRoleAlias } from '@rox/core/acl'
import { CommandRejection } from '@rox/core/commands'
import { isEntityKind, isEntityRelation, type EntityRef } from '@rox/core/entities'
import { REFERENCE_COLLECTIONS } from './collections'
import { deterministicId, isDeleted, type ReferenceOp, type ReferenceOutcome, type ReferenceTx } from './engine'
import type { RecordData, StoredRecord } from './types'

export type Mapper = (tx: ReferenceTx, current?: StoredRecord) => RecordData | Promise<RecordData>

export function omit(data: RecordData, keys: readonly string[]): RecordData {
  const out: RecordData = {}
  for (const [key, value] of Object.entries(data)) if (!keys.includes(key)) out[key] = value
  return out
}

/** Payload minus `id` and the listed keys. */
export const payloadFields = (...skip: string[]): Mapper => tx => omit(tx.payload, ['id', ...skip])

function outcome(collection: string, record: StoredRecord, changes: RecordData, extra: Partial<ReferenceOutcome> = {}): ReferenceOutcome {
  return { collection, id: record.id, revision: record.revision, changes: Object.keys(changes).sort(), ...extra }
}

/**
 * Create a record; `container` copies a matching target id into a field (e.g. a
 * section's list). A payload container id must repeat a target of that kind
 * (another id is FORBIDDEN) and is otherwise authorized at `write`.
 */
export function create(collection: string, map: Mapper = payloadFields(), options: { container?: { kind: string; field: string }; defaults?: Mapper; salt?: string } = {}): ReferenceOp {
  return async tx => {
    const data = { ...(options.defaults ? await options.defaults(tx) : {}), ...(await map(tx)) }
    if (options.container) {
      const { kind, field } = options.container
      const payloadId = tx.payload[field]
      if (typeof payloadId === 'string' && payloadId) await authorizeBound(tx, { kind, id: payloadId } as EntityRef, 'write')
      if (data[field] === undefined) {
        const containerId = tx.targetOf(kind)
        if (containerId) data[field] = containerId
      }
    }
    const record = await tx.insert(collection, tx.createId(options.salt), data)
    return outcome(collection, record, data)
  }
}

/** Patch the target with mapped changes (default: the payload). */
export function update(collection: string, map: Mapper = payloadFields(), options: { allowDeleted?: boolean } = {}): ReferenceOp {
  return async tx => {
    const current = await tx.requireTarget(collection, options)
    const changes = await map(tx, current)
    const record = await tx.update(collection, current, changes)
    return outcome(collection, record, changes)
  }
}

/** Fixed-value transition of the target (`values` sees the clock and the current record). */
export const transition = (collection: string, values: Mapper, options: { allowDeleted?: boolean } = {}) => update(collection, values, options)

/** Soft delete of the target (`deletedAt`). */
export function softDelete(collection: string): ReferenceOp {
  return async tx => {
    const current = await tx.requireTarget(collection)
    const record = await tx.softDelete(collection, current)
    return outcome(collection, record, { deletedAt: record.data.deletedAt })
  }
}

/** Create a child of the target (`parentField` = target id). */
export function childCreate(collection: string, parent: string, parentField: string, map: Mapper = payloadFields(), defaults: Mapper = () => ({})): ReferenceOp {
  return async tx => {
    const owner = await tx.requireTarget(parent)
    const data = { ...(await defaults(tx, owner)), ...(await map(tx, owner)), [parentField]: owner.id }
    const record = await tx.insert(collection, tx.createId(), data)
    return outcome(collection, record, data)
  }
}

/** Load a child (`payload[idKey]`) of the target, NOT_FOUND when it belongs to another parent. */
export async function requireChild(tx: ReferenceTx, collection: string, parent: string, parentField: string, idKey: string): Promise<{ owner: StoredRecord; child: StoredRecord }> {
  const owner = await tx.requireTarget(parent)
  const childId = tx.payload[idKey]
  if (typeof childId !== 'string') throw new CommandRejection('VALIDATION', `${idKey} required`)
  const child = await tx.require(collection, childId)
  if (child.data[parentField] !== owner.id) throw new CommandRejection('NOT_FOUND', `${childId} does not belong to ${owner.id}`)
  return { owner, child }
}

export function childUpdate(collection: string, parent: string, parentField: string, idKey: string, map: Mapper = tx => omit(tx.payload, [idKey])): ReferenceOp {
  return async tx => {
    const { child } = await requireChild(tx, collection, parent, parentField, idKey)
    const changes = await map(tx, child)
    const record = await tx.update(collection, child, changes)
    return outcome(collection, record, changes)
  }
}

export function childDelete(collection: string, parent: string, parentField: string, idKey: string): ReferenceOp {
  return async tx => {
    const { child } = await requireChild(tx, collection, parent, parentField, idKey)
    const record = await tx.softDelete(collection, child)
    return outcome(collection, record, { deletedAt: record.data.deletedAt })
  }
}

/** Association row `<parent id>:<key>` under the target (members, reactions, user state…). */
export function assoc(collection: string, parent: string, key: (tx: ReferenceTx) => string, map: Mapper = payloadFields(), parentField = 'parentId'): ReferenceOp {
  return async tx => {
    const owner = await tx.requireTarget(parent)
    const changes = await map(tx, owner)
    const row = await tx.upsert(collection, `${owner.id}:${key(tx)}`, changes, { [parentField]: owner.id })
    return outcome(collection, row, changes, { ref: tx.rawTarget ?? null })
  }
}

/** Delete association row(s); a missing row is NOT_FOUND. */
export function unassoc(collection: string, parent: string, key: (tx: ReferenceTx) => string): ReferenceOp {
  return async tx => {
    const owner = await tx.requireTarget(parent)
    const id = `${owner.id}:${key(tx)}`
    const row = await tx.get(collection, id)
    if (!row || isDeleted(row)) throw new CommandRejection('NOT_FOUND', `${id} not found`)
    const record = await tx.softDelete(collection, row)
    return outcome(collection, record, { deletedAt: record.data.deletedAt }, { ref: tx.rawTarget ?? null })
  }
}

/** Workspace-level settings row keyed by actor or fixed key (no target). */
export function setting(collection: string, key: (tx: ReferenceTx) => string, map: Mapper = payloadFields()): ReferenceOp {
  return async tx => {
    const changes = await map(tx)
    const row = await tx.upsert(collection, key(tx), changes)
    return outcome(collection, row, changes, { ref: tx.rawTarget ?? null })
  }
}

/** Patch several records of one collection (missing ids are skipped and reported). */
export async function patchMany(tx: ReferenceTx, collection: string, ids: readonly string[], changes: (record: StoredRecord, index: number) => RecordData): Promise<{ updated: string[]; missing: string[] }> {
  const updated: string[] = []
  const missing: string[] = []
  for (const [index, id] of ids.entries()) {
    const record = await tx.get(collection, id)
    if (!record || isDeleted(record)) { missing.push(id); continue }
    await tx.update(collection, record, changes(record, index))
    updated.push(id)
  }
  return { updated, missing }
}

export function refString(ref: EntityRef): string {
  return ref.fragment ? `${ref.kind}:${ref.id}#${ref.fragment}` : `${ref.kind}:${ref.id}`
}

/** Add an entity link (backend link sink when present, else the `entity-link` collection). */
export async function addLink(tx: ReferenceTx, from: EntityRef, to: EntityRef, relation: string, extra: { role?: string; anchor?: unknown } = {}): Promise<StoredRecord> {
  const id = deterministicId(tx.ctx.workspaceId, 'link', refString(from), refString(to), relation)
  return tx.upsert('entity-link', id, {
    fromKind: from.kind, fromId: from.id, fromFragment: from.fragment ?? null, toKind: to.kind, toId: to.id, toFragment: to.fragment ?? null,
    relation, role: extra.role ?? null, anchor: extra.anchor ?? null,
  })
}

export async function removeLink(tx: ReferenceTx, from: EntityRef, to: EntityRef, relation: string): Promise<StoredRecord | null> {
  const id = deterministicId(tx.ctx.workspaceId, 'link', refString(from), refString(to), relation)
  const row = await tx.get('entity-link', id)
  if (!row || isDeleted(row)) return null
  return tx.softDelete('entity-link', row)
}

/** Reject a link the local link index would refuse — call before the first write of a create-and-link op. */
export function validateLink(from: EntityRef, to: EntityRef, relation: string): void {
  if (!isEntityKind(from.kind) || !isEntityKind(to.kind)) throw new CommandRejection('VALIDATION', `unknown entity kind in link ${from.kind} → ${to.kind}`)
  if (!isEntityRelation(relation)) throw new CommandRejection('VALIDATION', `unknown relation ${relation}`)
}

/**
 * The resource a command acts on. The executor authorizes only the envelope
 * target, so a payload ref (`subject`, `from`) naming another resource is
 * FORBIDDEN; with `requireTarget` the target is mandatory (VALIDATION).
 * A matching payload ref wins (it may carry a fragment).
 */
export function boundRef(tx: ReferenceTx, payloadRef: EntityRef | undefined, options: { requireTarget?: boolean } = {}): EntityRef {
  const target = tx.rawTarget
  if (target && payloadRef && (target.kind !== payloadRef.kind || target.id !== payloadRef.id)) {
    throw new CommandRejection('FORBIDDEN', `${tx.commandType} acts on ${payloadRef.kind}:${payloadRef.id} but is authorized for ${target.kind}:${target.id}`)
  }
  if (!target && (options.requireTarget || !payloadRef)) throw new CommandRejection('VALIDATION', `${tx.commandType} needs a target`)
  return payloadRef ?? target!
}

/**
 * Rox2 verbs a payload-named resource is authorized at (the executor's
 * authorizer vocabulary): `write` for anything written to / into / moved /
 * reordered / linked from, `destroy` for deletes, `share` for ACL changes,
 * `read` for a resource that is only referenced.
 */
export type RefVerb = 'read' | 'write' | 'share' | 'destroy'

/**
 * Authorize a payload-named resource with the executor's authorizer
 * (FORBIDDEN when denied). The envelope target itself was already authorized
 * at the command verb, so it is skipped for that verb and for `read`.
 */
export async function authorizeRef(tx: ReferenceTx, ref: EntityRef, verb: RefVerb): Promise<EntityRef> {
  const target = tx.rawTarget
  if (target && target.kind === ref.kind && target.id === ref.id && (verb === 'read' || verb === tx.verb)) return ref
  if (!(await tx.can(verb, { kind: ref.kind, id: ref.id }))) {
    throw new CommandRejection('FORBIDDEN', `${tx.commandType} needs ${verb} on ${ref.kind}:${ref.id}`)
  }
  return ref
}

/**
 * A payload id naming the resource the command acts in (destination
 * container, doc, form): a target of the same kind with another id is
 * FORBIDDEN (`boundRef`), anything else is authorized at `verb`.
 */
export async function authorizeBound(tx: ReferenceTx, ref: EntityRef, verb: RefVerb = 'write'): Promise<EntityRef> {
  const target = tx.rawTarget
  if (target && target.kind === ref.kind && target.id !== ref.id) {
    throw new CommandRejection('FORBIDDEN', `${tx.commandType} acts on ${ref.kind}:${ref.id} but is authorized for ${target.kind}:${target.id}`)
  }
  return authorizeRef(tx, ref, verb)
}

/**
 * The origin a record is made from (a message, a mail thread, an event …) is
 * only referenced: `read`, bound to a target of its kind. A message origin
 * (`channel-message` `<chatId>:<seq>`) is read through its chat.
 */
export async function authorizeOrigin(tx: ReferenceTx, ref: EntityRef): Promise<void> {
  const chatId = ref.kind === 'channel-message' && ref.id.includes(':') ? ref.id.slice(0, ref.id.lastIndexOf(':')) : null
  await authorizeBound(tx, (chatId ? { kind: 'channel', id: chatId } : { kind: ref.kind, id: ref.id }) as EntityRef, 'read')
}

/** `authorizeRef` for an optional payload id of a known kind (absent / null ids are skipped). */
export async function authorizeId(tx: ReferenceTx, kind: string, id: unknown, verb: RefVerb, options: { bound?: boolean } = {}): Promise<void> {
  if (typeof id !== 'string' || !id) return
  const ref = { kind, id } as EntityRef
  if (options.bound) await authorizeBound(tx, ref, verb)
  else await authorizeRef(tx, ref, verb)
}

/** Payload fields of a work item that name its container (TECH-SPEC §4.3), by entity kind. */
export const TASK_CONTAINER_FIELDS: Readonly<Record<string, string>> = {
  listId: 'task-list', sectionId: 'task-section', listGroupId: 'task-list-group', parentId: 'task', projectId: 'project', milestoneId: 'milestone', spaceId: 'space',
}

/**
 * `write` on every container a task create / move names. `bound` (creates,
 * where a container-kind target IS the container) keeps a different id of the
 * target's kind FORBIDDEN.
 */
export async function authorizeTaskContainers(tx: ReferenceTx, fields: Record<string, unknown>, options: { bound?: boolean } = {}): Promise<void> {
  for (const [field, kind] of Object.entries(TASK_CONTAINER_FIELDS)) await authorizeId(tx, kind, fields[field], 'write', options)
}

/** Sharing into another workspace needs `write` there (the authorizer is asked about that workspace). */
export async function authorizeWorkspace(tx: ReferenceTx, workspaceId: unknown): Promise<void> {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId === tx.ctx.workspaceId) return
  if (!(await tx.can('write', null, { workspaceId }))) throw new CommandRejection('FORBIDDEN', `${tx.commandType} needs write in workspace ${workspaceId}`)
}

export function targetRef(tx: ReferenceTx): EntityRef {
  const target = tx.rawTarget
  if (!target) throw new CommandRejection('VALIDATION', `${tx.commandType} needs a target`)
  return target
}

/** Command principal kinds → the W1-05 `acl_entry.subject_type` vocabulary. */
export const ACL_SUBJECT_TYPE: Readonly<Record<string, string>> = { user: 'principal', agent: 'principal', group: 'department', space: 'space', workspace: 'workspace', link: 'link' }
export const subjectTypeOf = (kind: string): string => ACL_SUBJECT_TYPE[kind] ?? kind

/** Command role names (`full_access` …) → the W1-04 lattice stored in `acl_entry.role` (`manager`). */
export const storedAclRole = (role: string): string => normalizeRoleAlias(role) ?? role

/** Collection whose records are refs of `kind` (resources an ACL entry can name). */
export function collectionOfKind(kind: string): string | undefined {
  return Object.entries(REFERENCE_COLLECTIONS).find(([, spec]) => (spec as { kind?: string }).kind === kind)?.[0]
}

/** The record owner / creator of a resource (its implicit owner while it has no `owner` ACL entry). */
export async function recordOwnerOf(tx: ReferenceTx, subject: EntityRef): Promise<unknown> {
  const collection = collectionOfKind(subject.kind)
  const record = collection ? await tx.get(collection, subject.id) : null
  return record ? record.data.ownerId ?? record.data.ownerPrincipalId ?? record.data.createdBy : undefined
}

/**
 * Ownership changes only through `acl.transfer_ownership`: a grant, revoke,
 * access decision or permission edit of a principal's entry is FORBIDDEN when
 * that entry is `owner`, or — without an entry — when the principal is the
 * resource's implicit owner (record owner / creator).
 */
export async function assertNotOwner(tx: ReferenceTx, subject: EntityRef, principalId: string, entry: StoredRecord | null): Promise<void> {
  const live = entry && !isDeleted(entry) ? entry : null
  const owner = live ? live.data.role === storedAclRole('owner') : (await recordOwnerOf(tx, subject)) === principalId
  if (owner) throw new CommandRejection('FORBIDDEN', "the owner's access changes only through acl.transfer_ownership")
}
