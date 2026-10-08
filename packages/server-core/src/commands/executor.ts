/**
 * W1-03 (#1500) — Command executor (one per authority).
 *
 * Pipeline (fixed order, every negative path returns a `rejected` receipt and
 * commits nothing):
 *   bus enabled → decode envelope (VALIDATION) → definition (UNKNOWN_COMMAND)
 *   → authority (LOCAL_ONLY / SERVER_REQUIRED) → payload size
 *   (PAYLOAD_TOO_LARGE) → capability (UNAVAILABLE / NOT_BOUND) → payload
 *   schema (VALIDATION) → authorize (FORBIDDEN) → middleware (`use`, W1-11
 *   hook) → transactional execute.
 *
 * Idempotent replay comes first: right after decoding, a read-only receipt
 * lookup answers a retry of an already-applied command with `duplicate` (or
 * IDEMPOTENCY_KEY_REUSED for a different request / actor) before any policy
 * stage runs, so a lost-ack retry still gets `duplicate` after a flag flip,
 * an unbind, a stricter schema or an ACL change.
 *
 * Execute runs in one store transaction: locked idempotency lookup (same key/
 * command id + same request hash → `duplicate` with the original receipt;
 * different request → IDEMPOTENCY_KEY_REUSED) → handler (CommandConflict →
 * `conflict`) → domain events + receipt. Publication happens after commit
 * only; a failed publish never changes the receipt (projections are
 * re-derivable from the stored events).
 *
 * Failures: only *transient* infrastructure failures are retryable — an
 * error the store classifies as transient (`isTransientError`: lost
 * connection, deadlock, serialization failure, pool timeout; `cause` chains
 * are walked) or a failure to open the transaction at all (connection /
 * BEGIN, before the callback ran). Those commit nothing and are thrown as
 * `CommandStoreUnavailable`, so the host answers 503 and the client's outbox
 * retries. Every other error — a handler bug, or a deterministic store
 * rejection (invalid byte sequence, numeric overflow, 25P02 after a handler
 * swallowed a failed query) — is the terminal `rejected/INTERNAL` receipt, so
 * one bad command can never wedge a workspace's FIFO.
 *
 * Used by server-core (authority `local`, SQLite store) and by
 * workspace-service (authority `workspace`, Postgres store).
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  CommandConflict,
  CommandMiddlewareChain,
  CommandRejection,
  DEFAULT_MAX_COMMAND_PAYLOAD_BYTES,
  MAX_COMMAND_PAYLOAD_BYTES,
  authorize,
  canonicalCommandRequest,
  composeCommandMiddleware,
  conflictReceipt,
  createDefaultAuthorizer,
  duplicateReceipt,
  payloadByteLength,
  rejectedReceipt,
  type Authorizer,
  type CommandActor,
  type CommandEnvelope,
  type CommandErrorCode,
  type CommandMiddleware,
  type CommandPipelineContext,
  type CommandReceipt,
  type CommandRegistry,
  type ExecutionAuthority,
} from '@rox/core/commands'
import type { DomainEvent } from '@rox/core/events'
import { isDomainEventType } from '@rox/core/events'
import { decodeCommandEnvelope } from '@rox/shared/commands/schemas'
import { CommandStoreUnavailable, CommandStoreUniqueViolation, type CommandStore, type StoredCommandReceipt } from './store'

export interface CommandExecutionInput {
  workspaceId: string
  actor: CommandActor
  /** Untrusted wire envelope (decoded here) or an already decoded one. */
  envelope: unknown
}

export interface CommandExecutorOptions {
  registry: CommandRegistry
  store: CommandStore
  authority: ExecutionAuthority
  /** Defaults to `createDefaultAuthorizer()` — STUB(#1501) local owner shim. */
  authorizer?: Authorizer
  /** Live bus switch (flag `commands.bus.v1` locally); default on. */
  isEnabled?: () => boolean
  /** Post-commit publication of the committed events. */
  publish?: (events: DomainEvent[]) => void | Promise<void>
  onPublishError?: (error: unknown) => void
  /** Unexpected handler errors (logged by the host; the receipt says INTERNAL). */
  onHandlerError?: (error: unknown, envelope: CommandEnvelope) => void
  /** Store / connection failures (the call throws `CommandStoreUnavailable`). */
  onStoreError?: (error: unknown, envelope: CommandEnvelope) => void
  /** Default payload budget when the definition sets none. */
  maxPayloadBytes?: number
  now?: () => Date
  newEventId?: () => string
}

export function hashCommandRequest(envelope: CommandEnvelope): string {
  return createHash('sha256').update(canonicalCommandRequest(envelope)).digest('hex')
}

function rawCommandId(raw: unknown): string {
  const id = raw && typeof raw === 'object' ? (raw as { commandId?: unknown }).commandId : undefined
  return typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : ''
}

/** A deterministic error thrown by the handler itself (→ INTERNAL receipt). */
class HandlerFailure extends Error {
  constructor(readonly original: unknown) {
    super('handler failed')
    this.name = 'HandlerFailure'
  }
}

type TransactionOutcome =
  | { kind: 'applied'; receipt: CommandReceipt; events: DomainEvent[] }
  | { kind: 'existing'; stored: StoredCommandReceipt }

export class CommandExecutor {
  readonly authority: ExecutionAuthority
  private readonly registry: CommandRegistry
  private readonly store: CommandStore
  private readonly authorizer: Authorizer
  private readonly middleware = new CommandMiddlewareChain()
  private readonly options: CommandExecutorOptions

  constructor(options: CommandExecutorOptions) {
    this.options = options
    this.registry = options.registry
    this.store = options.store
    this.authority = options.authority
    this.authorizer = options.authorizer ?? createDefaultAuthorizer()
  }

  /** Insert policy middleware between `authorize` and `execute` (W1-11 #1508). */
  use(middleware: CommandMiddleware): this {
    this.middleware.use(middleware)
    return this
  }

  middlewareNames(): string[] {
    return this.middleware.names()
  }

  async execute(input: CommandExecutionInput): Promise<CommandReceipt> {
    const fallbackId = rawCommandId(input.envelope)
    if (this.options.isEnabled && !safeBool(this.options.isEnabled)) {
      return rejectedReceipt(fallbackId, 'UNAVAILABLE', 'Command bus is disabled')
    }
    if (!input.workspaceId || !input.actor?.principalId) {
      return rejectedReceipt(fallbackId, 'FORBIDDEN', 'No authenticated actor')
    }
    if (payloadByteLength(input.envelope) > MAX_COMMAND_PAYLOAD_BYTES + 16 * 1024) {
      return rejectedReceipt(fallbackId, 'PAYLOAD_TOO_LARGE', 'Command envelope exceeds the hard size limit')
    }

    const decoded = decodeCommandEnvelope(input.envelope)
    if (!decoded.ok) return rejectedReceipt(fallbackId, 'VALIDATION', decoded.message, { issues: decoded.issues })
    const envelope = decoded.value

    // Read-only idempotent replay before every policy stage (the locked lookup
    // inside the transaction still decides races).
    const requestHash = hashCommandRequest(envelope)
    let previous: StoredCommandReceipt | null
    try {
      previous = await this.store.findReceipt(input.workspaceId, envelope.idempotencyKey, envelope.commandId)
    } catch (error) {
      return this.storeFailure(envelope, error)
    }
    if (previous) return this.replay(previous, envelope, input.actor, requestHash)

    const definition = this.registry.get(envelope.type)
    if (!definition) return rejectedReceipt(envelope.commandId, 'UNKNOWN_COMMAND', `Unknown command: ${envelope.type}`)
    if (this.authority === 'workspace' && definition.authority === 'local') {
      return rejectedReceipt(envelope.commandId, 'LOCAL_ONLY', `${envelope.type} runs on the local authority only`)
    }
    if (this.authority === 'local' && definition.authority === 'workspace') {
      return rejectedReceipt(envelope.commandId, 'SERVER_REQUIRED', `${envelope.type} runs on the workspace authority only`)
    }

    const limit = Math.min(definition.maxPayloadBytes ?? this.options.maxPayloadBytes ?? DEFAULT_MAX_COMMAND_PAYLOAD_BYTES, MAX_COMMAND_PAYLOAD_BYTES)
    const size = payloadByteLength(envelope.payload)
    if (size > limit) {
      return rejectedReceipt(envelope.commandId, 'PAYLOAD_TOO_LARGE', `Payload exceeds ${limit} bytes`, { limit, size: Number.isFinite(size) ? size : null })
    }

    const capability = this.registry.capability(envelope.type)
    if (!capability.available) {
      if (capability.reason === 'not_bound') return rejectedReceipt(envelope.commandId, 'NOT_BOUND', `${envelope.type} has no handler yet`)
      return rejectedReceipt(envelope.commandId, 'UNAVAILABLE', `${envelope.type} is unavailable (${capability.reason})`)
    }
    const handler = this.registry.handler(envelope.type)
    if (!handler) return rejectedReceipt(envelope.commandId, 'NOT_BOUND', `${envelope.type} has no handler yet`)

    const parsed = definition.schema.safeParse(envelope.payload)
    if (!parsed.success) {
      return rejectedReceipt(envelope.commandId, 'VALIDATION', errorMessage(parsed.error, 'Invalid payload'))
    }

    const principal = { ...input.actor, ...(envelope.onBehalfOf ? { onBehalfOf: envelope.onBehalfOf } : {}), workspaceId: input.workspaceId }
    if (!(await authorize(this.authorizer, principal, definition.verb, envelope.target ?? null))) {
      return rejectedReceipt(envelope.commandId, 'FORBIDDEN', 'Not allowed')
    }

    const ctx: CommandPipelineContext = {
      envelope,
      definition,
      payload: parsed.data,
      workspaceId: input.workspaceId,
      actor: input.actor,
      authority: this.authority,
      state: new Map(),
    }
    const run = composeCommandMiddleware(this.middleware.list(), pipelineCtx => this.executeInTransaction(pipelineCtx))
    try {
      return await run(ctx)
    } catch (error) {
      if (error instanceof CommandStoreUnavailable) throw error
      return this.errorReceipt(envelope, error)
    }
  }

  private unavailable(envelope: CommandEnvelope, error: unknown): CommandStoreUnavailable {
    if (error instanceof CommandStoreUnavailable) return error
    this.options.onStoreError?.(error, envelope)
    return new CommandStoreUnavailable(error)
  }

  /**
   * A store call failed: transient (or the transaction never opened) → throw
   * `CommandStoreUnavailable` (retry); anything else is deterministic → the
   * terminal INTERNAL receipt.
   */
  private storeFailure(envelope: CommandEnvelope, error: unknown, notOpened = false): CommandReceipt {
    if (error instanceof CommandStoreUnavailable) throw error
    if (notOpened || this.isTransient(error)) throw this.unavailable(envelope, error)
    this.options.onStoreError?.(error, envelope)
    return rejectedReceipt(envelope.commandId, 'INTERNAL', 'Command failed; no effect was committed')
  }

  private async executeInTransaction(ctx: CommandPipelineContext): Promise<CommandReceipt> {
    const { envelope, workspaceId, actor } = ctx
    const handler = this.registry.handler(envelope.type)
    if (!handler) return rejectedReceipt(envelope.commandId, 'NOT_BOUND', `${envelope.type} has no handler yet`)
    const requestHash = hashCommandRequest(envelope)
    const now = () => (this.options.now?.() ?? new Date()).toISOString()

    let outcome: TransactionOutcome
    let opened = false
    try {
      outcome = await this.store.transaction(workspaceId, async tx => {
        opened = true
        const existing = await tx.findReceipt(workspaceId, envelope.idempotencyKey, envelope.commandId)
        if (existing) return { kind: 'existing', stored: existing }

        let result
        try {
          result = (await handler({
            envelope,
            payload: ctx.payload,
            workspaceId,
            actor,
            authority: this.authority,
            transaction: tx.handle,
            conflict(currentRevision: number, current?: unknown): never {
              throw new CommandConflict(currentRevision, current)
            },
          })) ?? {}
        } catch (error) {
          if (error instanceof CommandConflict || error instanceof CommandRejection) throw error
          // A transient store error surfacing through the handler's queries stays retryable.
          if (this.isTransient(error)) throw error
          throw new HandlerFailure(error)
        }

        const createdAt = now()
        const drafts = result.events ?? []
        const events: DomainEvent[] = drafts.map(draft => {
          if (!isDomainEventType(draft.type)) throw new CommandRejection('INTERNAL', `Handler emitted invalid event type ${String(draft.type)}`)
          const subject = draft.subject ?? result.ref ?? envelope.target
          const event: DomainEvent = {
            eventId: this.options.newEventId?.() ?? randomUUID(),
            workspaceId,
            type: draft.type,
            actorId: actor.principalId,
            aggregateRevision: result.revision ?? 0,
            causationId: envelope.commandId,
            correlationId: envelope.correlationId ?? envelope.commandId,
            payload: draft.payload ?? {},
            createdAt,
          }
          if (subject) event.subject = { kind: subject.kind, id: subject.id }
          return event
        })
        const stored = events.length > 0 ? await tx.appendEvents(events) : []

        const receipt: CommandReceipt = { commandId: envelope.commandId, status: 'applied' }
        if (result.ref) receipt.ref = result.ref
        if (result.revision !== undefined) receipt.revision = result.revision
        if (stored.length > 0) receipt.eventIds = stored.map(event => event.eventId)
        if (result.result !== undefined) receipt.result = result.result

        await tx.saveReceipt({
          workspaceId,
          idempotencyKey: envelope.idempotencyKey,
          commandId: envelope.commandId,
          actorId: actor.principalId,
          requestHash,
          observedRevision: envelope.expectedRevision ?? null,
          receipt,
          createdAt,
        })
        return { kind: 'applied', receipt, events: stored }
      })
    } catch (error) {
      if (error instanceof CommandStoreUniqueViolation) {
        // A concurrent writer won; its transaction is the one effect.
        let stored: StoredCommandReceipt | null
        try { stored = await this.store.findReceipt(workspaceId, envelope.idempotencyKey, envelope.commandId) }
        catch (findError) { return this.storeFailure(envelope, findError) }
        if (stored) return this.replay(stored, envelope, actor, requestHash)
        // The winner is not visible yet: a race, retry later.
        throw this.unavailable(envelope, error)
      }
      if (error instanceof HandlerFailure) return this.errorReceipt(envelope, error.original)
      if (error instanceof CommandConflict || error instanceof CommandRejection) return this.errorReceipt(envelope, error)
      // From the store (BEGIN, locks, inserts, COMMIT) or a transient handler error.
      return this.storeFailure(envelope, error, !opened)
    }

    if (outcome.kind === 'existing') return this.replay(outcome.stored, envelope, actor, requestHash)

    if (outcome.events.length > 0 && this.options.publish) {
      try {
        await this.options.publish(outcome.events)
      } catch (error) {
        this.options.onPublishError?.(error)
      }
    }
    return outcome.receipt
  }

  private isTransient(error: unknown): boolean {
    try { return this.store.isTransientError?.(error) === true } catch { return false }
  }

  private replay(stored: StoredCommandReceipt, envelope: CommandEnvelope, actor: CommandActor, requestHash: string): CommandReceipt {
    if (stored.requestHash !== requestHash || stored.actorId !== actor.principalId) {
      return rejectedReceipt(envelope.commandId, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key or command id was already used for a different request')
    }
    return duplicateReceipt(stored.receipt)
  }

  private errorReceipt(envelope: CommandEnvelope, error: unknown): CommandReceipt {
    if (error instanceof CommandConflict) return conflictReceipt(envelope.commandId, error.currentRevision, error.current)
    if (error instanceof CommandRejection) return rejectedReceipt(envelope.commandId, error.code as CommandErrorCode, error.message, error.details)
    this.options.onHandlerError?.(error, envelope)
    return rejectedReceipt(envelope.commandId, 'INTERNAL', 'Command failed; no effect was committed')
  }
}

function safeBool(fn: () => boolean): boolean {
  try { return fn() === true } catch { return false }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const issues = (error as { issues?: Array<{ message?: string; path?: unknown[] }> }).issues
    if (Array.isArray(issues) && issues[0]?.message) {
      const path = Array.isArray(issues[0].path) && issues[0].path.length > 0 ? `${issues[0].path.join('.')}: ` : ''
      return `${path}${issues[0].message}`
    }
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}
