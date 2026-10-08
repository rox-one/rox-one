/**
 * W1-06 (#1503) — Reference-handler engine.
 *
 * A reference op is a small async function over `ReferenceTx`, which wraps
 * one command execution: target resolution (VALIDATION / NOT_FOUND),
 * `expectedRevision` checks (conflict receipt), CAS writes through the
 * backend, deterministic ids and the domain event. ACL, flags, payload
 * schemas and idempotency are the executor's job (W1-03) and happen before
 * the op runs.
 */

import { createHash } from 'node:crypto'
import { CommandRejection, type CommandHandler, type CommandHandlerContext, type CommandHandlerResult } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import type { DomainEventDraft, DomainEventType } from '@rox/core/events'
import { acceptedTargetKinds, collectionSpec, refKind } from './collections'
import type { RecordBackend, RecordData, StoredRecord } from './types'

/** Field the engine stamps with the last command id (local retry detection). */
export const LAST_COMMAND_FIELD = 'lastCommandId'

export interface ReferenceOutcome {
  collection: string
  id: string
  revision?: number
  /** Ref for the receipt (default: the record's ref when its collection has a kind, else the target). */
  ref?: EntityRef | null
  result?: Record<string, unknown>
  /** Changed field names (event payload). */
  changes?: readonly string[]
}

export type ReferenceOp = (tx: ReferenceTx) => Promise<ReferenceOutcome>

export interface ReferenceEngineOptions {
  now: () => Date
  backendFor: (ctx: CommandHandlerContext<unknown>) => Promise<RecordBackend> | RecordBackend
}

/** Deterministic uuid-shaped id (sha256 of the parts). */
export function deterministicId(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function isDeleted(record: StoredRecord | null): boolean {
  return Boolean(record?.data.deletedAt)
}

function clean(data: RecordData): RecordData {
  const out: RecordData = {}
  for (const [key, value] of Object.entries(data)) if (value !== undefined) out[key] = value
  return out
}

export class ReferenceTx {
  readonly payload: Record<string, any>
  readonly now: string
  readonly events: DomainEventDraft[] = []
  /** Records this execution wrote (`collection\u0000id`), to tell them from an earlier attempt's. */
  private readonly written = new Set<string>()

  constructor(readonly ctx: CommandHandlerContext<unknown>, readonly backend: RecordBackend, now: Date, readonly verb = 'write') {
    this.payload = (ctx.payload ?? {}) as Record<string, any>
    this.now = now.toISOString()
  }

  /**
   * The executor's authorizer for this command's principal (fail closed: no
   * authorizer, or a non-transient authorizer error, denies).
   */
  async can(action: string, ref: EntityRef | null, options: { workspaceId?: string } = {}): Promise<boolean> {
    if (!this.ctx.authorize) return false
    return (await this.ctx.authorize(action, ref, options)) === true
  }

  get actor(): string {
    return this.ctx.actor.principalId
  }

  get commandType(): string {
    return this.ctx.envelope.type
  }

  /** Deterministic id for a record this command creates (stable across retries). */
  newId(salt = ''): string {
    return deterministicId(this.ctx.workspaceId, this.ctx.envelope.commandId, salt)
  }

  /** Client id from the payload, else a deterministic one. */
  createId(salt = ''): string {
    const id = this.payload.id
    return typeof id === 'string' && id ? id : this.newId(salt)
  }

  get rawTarget(): EntityRef | undefined {
    return this.ctx.envelope.target
  }

  /** The envelope target, which must be a record of `collection`. */
  target(collection: string): string {
    const target = this.rawTarget
    if (!target) throw new CommandRejection('VALIDATION', `${this.commandType} needs a target`)
    const kinds = acceptedTargetKinds(collection)
    if (kinds.length > 0 && !kinds.includes(target.kind)) {
      throw new CommandRejection('VALIDATION', `${this.commandType} targets ${kinds.join(' | ')}, not ${target.kind}`)
    }
    return target.id
  }

  /** The target id when its kind matches, else undefined (container targets of creates). */
  targetOf(kind: string): string | undefined {
    return this.rawTarget?.kind === kind ? this.rawTarget.id : undefined
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    collectionSpec(collection)
    return this.backend.get(collection, id)
  }

  async require(collection: string, id: string, options: { allowDeleted?: boolean } = {}): Promise<StoredRecord> {
    const record = await this.get(collection, id)
    // A retried soft delete finds its own tombstone.
    if (!record || (!options.allowDeleted && isDeleted(record) && !this.isPriorAttempt(record, collection))) {
      throw new CommandRejection('NOT_FOUND', `${refKind(collection)} ${id} not found`)
    }
    return record
  }

  /** Load the target record and apply the envelope's `expectedRevision`. */
  async requireTarget(collection: string, options: { allowDeleted?: boolean } = {}): Promise<StoredRecord> {
    const record = await this.require(collection, this.target(collection), options)
    this.checkExpected(collection, record)
    return record
  }

  checkExpected(collection: string, record: StoredRecord): void {
    const expected = this.ctx.envelope.expectedRevision
    if (expected === undefined || expected === record.revision) return
    // A retried command whose receipt was lost finds its own write one revision on.
    if (this.isPriorAttempt(record, collection)) return
    this.ctx.conflict(record.revision, { id: record.id, ...record.data })
  }

  /** True when `record` was last written by an earlier attempt of this very command. */
  private isPriorAttempt(record: StoredRecord, collection: string): boolean {
    return record.data[LAST_COMMAND_FIELD] === this.ctx.envelope.commandId && !this.written.has(writtenKey(collection, record.id))
  }

  /**
   * Fail before the first write of a multi-record op when any id is taken by
   * another command (a retry of this command finds its own records and passes).
   */
  async assertAbsent(collection: string, ...ids: string[]): Promise<void> {
    for (const id of ids) {
      const existing = await this.get(collection, id)
      if (existing && existing.data[LAST_COMMAND_FIELD] !== this.ctx.envelope.commandId) this.createConflict(existing.revision)
    }
  }

  /** A create hit an existing id: report only its revision, never the record (it may be outside the caller's ACL). */
  private createConflict(revision: number): never {
    return this.ctx.conflict(revision, { error: 'id already exists' })
  }

  /** Insert a new record. Re-running the same command finds its own record and returns it. */
  async insert(collection: string, id: string, data: RecordData): Promise<StoredRecord> {
    const existing = await this.get(collection, id)
    if (existing) {
      if (existing.data[LAST_COMMAND_FIELD] === this.ctx.envelope.commandId) return existing
      this.createConflict(existing.revision)
    }
    const record = clean({ ...data, createdAt: this.now, updatedAt: this.now, createdBy: this.actor, [LAST_COMMAND_FIELD]: this.ctx.envelope.commandId })
    const written = await this.backend.put({ collection, id, expectedRevision: null, data: record })
    if (written.status === 'conflict') this.createConflict(written.current?.revision ?? 0)
    this.written.add(writtenKey(collection, id))
    return { id, revision: written.revision, data: record }
  }

  /** Merge `changes` into a record (`null` clears a field); CAS on its revision. */
  async update(collection: string, record: StoredRecord, changes: RecordData): Promise<StoredRecord> {
    // Retry of a command whose receipt was lost: its write already landed — return it, don't apply twice.
    if (this.isPriorAttempt(record, collection)) return record
    const data: RecordData = { ...record.data }
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue
      if (value === null) delete data[key]
      else data[key] = value
    }
    data.updatedAt = this.now
    data[LAST_COMMAND_FIELD] = this.ctx.envelope.commandId
    const written = await this.backend.put({ collection, id: record.id, expectedRevision: record.revision, data })
    if (written.status === 'conflict') {
      // The current record goes back only for the authorized target (the caller may rebase on it).
      const isTarget = this.rawTarget?.id === record.id
      this.ctx.conflict(written.current?.revision ?? record.revision, isTarget && written.current ? { id: record.id, ...written.current.data } : undefined)
    }
    this.written.add(writtenKey(collection, record.id))
    return { id: record.id, revision: written.revision, data }
  }

  /** Insert or merge an association row keyed by `id`. */
  async upsert(collection: string, id: string, changes: RecordData, base: RecordData = {}): Promise<StoredRecord> {
    const current = await this.get(collection, id)
    if (!current) return this.insert(collection, id, { ...base, ...changes })
    return this.update(collection, current, { ...changes, deletedAt: null })
  }

  async softDelete(collection: string, record: StoredRecord): Promise<StoredRecord> {
    return this.update(collection, record, { deletedAt: this.now })
  }

  async remove(collection: string, id: string): Promise<boolean> {
    return this.backend.remove(collection, id)
  }

  emit(type: string, payload: Record<string, unknown> = {}, subject?: EntityRef): void {
    this.events.push({ type: type as DomainEventType, payload, ...(subject ? { subject } : {}) })
  }
}

const writtenKey = (collection: string, id: string) => `${collection}\u0000${id}`

/** Build one catalogue command's handler from its op. */
export function referenceHandler(type: string, op: ReferenceOp, options: ReferenceEngineOptions & { eventType?: string; verb?: string }): CommandHandler<unknown, unknown> {
  return async ctx => {
    const backend = await options.backendFor(ctx)
    const tx = new ReferenceTx(ctx, backend, options.now(), options.verb)
    const outcome = await op(tx)
    const spec = collectionSpec(outcome.collection)
    const ref = outcome.ref === null ? undefined : outcome.ref ?? (spec.kind ? { kind: spec.kind, id: outcome.id } : ctx.envelope.target)
    const primary: DomainEventDraft = {
      type: (options.eventType ?? type) as DomainEventType,
      payload: {
        reference: true,
        command: type,
        collection: outcome.collection,
        id: outcome.id,
        ...(outcome.revision !== undefined ? { revision: outcome.revision } : {}),
        ...(outcome.changes ? { changes: [...outcome.changes] } : {}),
      },
    }
    const result: CommandHandlerResult<unknown> = {
      events: [primary, ...tx.events, ...(backend.drainEvents?.() ?? [])],
      result: { collection: outcome.collection, id: outcome.id, ...(outcome.result ?? {}) },
    }
    if (ref) result.ref = ref
    if (outcome.revision !== undefined) result.revision = outcome.revision
    return result
  }
}
