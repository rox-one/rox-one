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
  close?(): void | Promise<void>
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
  private sequence = 0
  private readonly mutex = new KeyedMutex()

  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    return this.mutex.run(workspaceId, async () => {
      const stagedReceipts: StoredCommandReceipt[] = []
      const stagedEvents: DomainEvent[] = []
      let nextSequence = this.sequence
      const tx: CommandStoreTransaction = {
        handle: { kind: 'memory', workspaceId },
        findReceipt: async (ws, key, commandId) => this.find([...this.receipts, ...stagedReceipts], ws, key, commandId),
        appendEvents: async events => {
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
      this.sequence = nextSequence
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

  /** Test helper: number of committed receipts / events. */
  counts(): { receipts: number; events: number } {
    return { receipts: this.receipts.length, events: this.events.length }
  }

  private find(rows: StoredCommandReceipt[], workspaceId: string, key: string, commandId: string): StoredCommandReceipt | null {
    const row = rows.find(r => r.workspaceId === workspaceId && (r.idempotencyKey === key || r.commandId === commandId))
    return row ? clone(row) : null
  }
}
