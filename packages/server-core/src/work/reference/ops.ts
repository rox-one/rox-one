/**
 * W1-06 (#1503) — Op combinators for reference handlers (create / update /
 * transition / delete / child rows / association rows / links).
 */

import { normalizeRoleAlias } from '@rox/core/acl'
import { CommandRejection } from '@rox/core/commands'
import { isEntityKind, isEntityRelation, type EntityRef } from '@rox/core/entities'
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

/** Create a record; `container` copies a matching target id into a field (e.g. a section's list). */
export function create(collection: string, map: Mapper = payloadFields(), options: { container?: { kind: string; field: string }; defaults?: Mapper; salt?: string } = {}): ReferenceOp {
  return async tx => {
    const data = { ...(options.defaults ? await options.defaults(tx) : {}), ...(await map(tx)) }
    if (options.container && data[options.container.field] === undefined) {
      const containerId = tx.targetOf(options.container.kind)
      if (containerId) data[options.container.field] = containerId
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
