/**
 * W1-03 (#1500) — Transactional command store port.
 *
 * One transaction writes the handler's effect, its `domain_event` rows and the
 * `command_receipt` row (transactional outbox, TECH-SPEC §3.4). Implemented by
 * the in-memory store (tests, ephemeral hosts), the workspace-local SQLite
 * store (`local-store.ts`) and the Postgres store in workspace-service.
 */

import type { CommandReceipt } from '@rox/core/commands'
import type { DomainEvent } from '@rox/core/events'

export interface StoredCommandReceipt {
  workspaceId: string
  idempotencyKey: string
  commandId: string
  actorId: string
  /** sha256 hex of `canonicalCommandRequest(envelope)`. */
  requestHash: string
  observedRevision: number | null
  receipt: CommandReceipt
  createdAt: string
}

export interface CommandStoreTransaction {
  /** Store-specific handle passed to handlers as `ctx.transaction`. */
  readonly handle: unknown
  /** Receipt stored under this idempotency key OR this command id. */
  findReceipt(workspaceId: string, idempotencyKey: string, commandId: string): Promise<StoredCommandReceipt | null>
  /** Append events; returns them with their store `sequence`. */
  appendEvents(events: DomainEvent[]): Promise<DomainEvent[]>
  /** Throws `CommandStoreUniqueViolation` when the key or command id already exists. */
  saveReceipt(record: StoredCommandReceipt): Promise<void>
}

export interface ListEventsOptions {
  afterSequence?: number
  limit?: number
}

export interface CommandStore {
  /** Run `fn` atomically; any throw rolls back every write made through `tx`. */
  transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T>
  findReceipt(workspaceId: string, idempotencyKey: string, commandId: string): Promise<StoredCommandReceipt | null>
  /** Stored events in sequence order (projections are re-derivable from these). */
  listEvents(workspaceId: string, options?: ListEventsOptions): Promise<DomainEvent[]>
  /**
   * Highest committed event sequence per workspace. The relay reads it once at
   * startup, so its first watermark never depends on which commit publishes first.
   */
  latestSequences?(): Promise<Map<string, number>>
  /**
   * Whether an error thrown inside a handler is a transient infrastructure
   * failure (lost connection, deadlock, serialization failure, pool timeout).
   * Those are retried by the client instead of becoming an INTERNAL receipt.
   */
  isTransientError?(error: unknown): boolean
  close?(): void | Promise<void>
}

/**
 * The store (or its connection) failed while executing a command: nothing was
 * committed and the request may be retried with the same envelope. Hosts map it
 * to a retryable transport answer (HTTP 503); it never becomes a receipt.
 */
export class CommandStoreUnavailable extends Error {
  readonly retryable = true
  constructor(readonly cause: unknown, message = 'Command store unavailable; nothing was committed') {
    super(message)
    this.name = 'CommandStoreUnavailable'
  }
}

/** Maximum `error.cause` depth walked when classifying store errors. */
export const MAX_ERROR_CAUSE_DEPTH = 8

/**
 * Whether `predicate` holds for `error` or any error in its `cause` chain
 * (bounded, cycle-safe; AggregateError members are checked too). Handlers that
 * wrap a driver error (`new Error('x', { cause })`) keep it classifiable.
 */
export function someErrorInChain(error: unknown, predicate: (candidate: unknown) => boolean, maxDepth = MAX_ERROR_CAUSE_DEPTH): boolean {
  const seen = new Set<unknown>()
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }]
  while (queue.length > 0) {
    const { value, depth } = queue.shift()!
    if (value === null || value === undefined || seen.has(value)) continue
    seen.add(value)
    try { if (predicate(value)) return true } catch { /* keep walking */ }
    if (depth >= maxDepth || typeof value !== 'object') continue
    const cause = (value as { cause?: unknown }).cause
    if (cause !== undefined) queue.push({ value: cause, depth: depth + 1 })
    const errors = (value as { errors?: unknown }).errors
    if (Array.isArray(errors)) for (const item of errors.slice(0, 8)) queue.push({ value: item, depth: depth + 1 })
  }
  return false
}

/** A concurrent writer committed the same idempotency key / command id first. */
export class CommandStoreUniqueViolation extends Error {
  constructor(message = 'command receipt already exists') {
    super(message)
    this.name = 'CommandStoreUniqueViolation'
  }
}

/** Per-key async mutex (serialises transactions of one workspace). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/** In-memory store: staged writes become visible only when the transaction commits. */
export class InMemoryCommandStore implements CommandStore {
  private readonly receipts: StoredCommandReceipt[] = []
  private readonly events: DomainEvent[] = []
  /** Per-workspace counters: transactions of different workspaces run concurrently. */
  private readonly sequences = new Map<string, number>()
  private readonly mutex = new KeyedMutex()

  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    return this.mutex.run(workspaceId, async () => {
      const stagedReceipts: StoredCommandReceipt[] = []
      const stagedEvents: DomainEvent[] = []
      let nextSequence = this.sequences.get(workspaceId) ?? 0
      const tx: CommandStoreTransaction = {
        handle: { kind: 'memory', workspaceId },
        findReceipt: async (ws, key, commandId) => this.find([...this.receipts, ...stagedReceipts], ws, key, commandId),
        appendEvents: async events => {
          if (events.some(event => event.workspaceId !== workspaceId)) throw new Error('Events must belong to the transaction workspace')
          const stored = events.map(event => ({ ...clone(event), sequence: ++nextSequence }))
          stagedEvents.push(...stored)
          return stored.map(clone)
        },
        saveReceipt: async record => {
          if (this.find([...this.receipts, ...stagedReceipts], record.workspaceId, record.idempotencyKey, record.commandId)) {
            throw new CommandStoreUniqueViolation()
          }
          stagedReceipts.push(clone(record))
        },
      }
      const result = await fn(tx)
      this.receipts.push(...stagedReceipts)
      this.events.push(...stagedEvents)
      this.sequences.set(workspaceId, nextSequence)
      return result
    })
  }

  async findReceipt(workspaceId: string, idempotencyKey: string, commandId: string): Promise<StoredCommandReceipt | null> {
    return this.find(this.receipts, workspaceId, idempotencyKey, commandId)
  }

  async listEvents(workspaceId: string, options: ListEventsOptions = {}): Promise<DomainEvent[]> {
    const after = options.afterSequence ?? 0
    const matching = this.events.filter(event => event.workspaceId === workspaceId && (event.sequence ?? 0) > after)
    return matching.slice(0, options.limit ?? matching.length).map(clone)
  }

  async latestSequences(): Promise<Map<string, number>> {
    return new Map(this.sequences)
  }

  /** Test helper: number of committed receipts / events. */
  counts(): { receipts: number; events: number } {
    return { receipts: this.receipts.length, events: this.events.length }
  }

  private find(rows: StoredCommandReceipt[], workspaceId: string, key: string, commandId: string): StoredCommandReceipt | null {
    const row = rows.find(r => r.workspaceId === workspaceId && (r.idempotencyKey === key || r.commandId === commandId))
    return row ? clone(row) : null
  }
}
