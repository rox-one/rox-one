/**
 * W1-15 (#1512) — the single adapter the X-13…X-26 reference handlers talk to
 * (TECH-SPEC §20).
 *
 * Every reference handler is pure decision logic over this port set, so the
 * harness can run X-13…X-26 without a server, and wave-2 owner modules swap
 * one function (`createXfnPorts`) instead of rewriting a handler.
 *
 * Owner modules and the issue that replaces each stub:
 * - `dispatch` / `query` → the owner modules of X-14…X-24 (XFN #1534 wires the
 *   real command pipeline; the reference dispatcher is `STUB(#1534)`);
 * - `reminders` → tasks / calendar (X-16, `STUB(#1534)`);
 * - `pins` → core (X-26): the local store file or the workspace `entity_link`;
 * - `acl` → W1-04's `Acl` engine (`@rox/core/acl`), already present.
 */

import type { EntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { CommandHandlerContext, CommandHandlerResult } from '../commands/registry.ts'
import type { CommandType } from '../commands/envelope.ts'
import { sortPins, type LocalPinsState, type PinLink, EMPTY_LOCAL_PINS_STATE, recordLocalPins } from '../acl/rules/pin-private.ts'
import type { Acl } from '../acl/evaluate.ts'

/** What a reference handler may ask of the host. */
export interface XfnPorts {
  /** Current time (deterministic in tests). */
  now(): Date
  /** Who is acting; the owner of every write the reference handlers request. */
  actor: { principalId: string; kind: 'user' | 'system' | 'agent'; onBehalfOf?: string }
  /** Workspace id, or `null` in local-only mode. */
  workspaceId: string | null
  /**
   * STUB(#1534): run one resolved owner command. Wave 2 replaces this with the
   * real command pipeline (`CommandRegistry` handler invocation). The
   * reference implementation records the call and echoes a receipt.
   */
  dispatch(command: CommandType, payload: unknown, ctx: CommandHandlerContext<unknown>): Promise<CommandHandlerResult>
  /**
   * STUB(#1534): run an owner read model (`people.get_overview`,
   * `agenda.today`, the check-in draft source, the goal work roll-up).
   */
  query(name: string, params: unknown): Promise<unknown>
  /** STUB(#1534): the local `reminder` kind 18 store (tasks / calendar). */
  reminders: {
    create(record: unknown): Promise<{ id: string }>
    cancel(id: string): Promise<boolean>
  }
  /** STUB(#1534): the `decision` store (kind 49), written by X-15. */
  decisions: {
    create(input: { title: string; body?: string; originRef?: EntityRef; decidedAt?: string }): Promise<{ ref: EntityRef }>
  }
  /** STUB(#1534): the tables store, written by the X-23 runtime action. */
  tables: {
    insertRow(input: { baseRef: EntityRef; tableRef?: EntityRef; row: Record<string, unknown>; idempotencyKey?: string }): Promise<{ ref: EntityRef; rowId: string }>
  }
  /**
   * STUB(#1534): the `call` store (kind `call`), written by X-24. The owner
   * action, called directly — never re-entered as the `vc.start_meeting`
   * command, which would recurse into this handler.
   */
  calls: {
    startMeeting(input: {
      originRef: EntityRef
      invite: readonly string[]
      eventRef?: EntityRef
      notesDocRef?: EntityRef
    }): Promise<{ ref: EntityRef }>
  }
  /** X-26 pins: local `{configDir}/ui/pins.json` or the workspace `entity_link` store. */
  pins: {
    load(): Promise<LocalPinsState>
    save(state: LocalPinsState): Promise<void>
    /** Local-only convenience: write the local store in one call. */
    record(refs: readonly EntityRef[]): Promise<void>
  }
  /** W1-04's ACL engine, when the host has one (read-model redaction). */
  acl?: Acl
}

export interface XfnActor {
  principalId: string
  kind: 'user' | 'system' | 'agent'
  onBehalfOf?: string
}

/**
 * Reference port set: in-memory, deterministic, no I/O outside the temp store
 * the caller passes. Every stub is marked with the issue that replaces it.
 */
export interface CreateXfnPortsOptions {
  actor: XfnActor
  workspaceId?: string | null
  now?: () => Date
  /** STUB(#1534): recorded dispatches, in order. */
  journal?: { dispatches: Array<{ command: CommandType; payload: unknown }> }
  /** STUB(#1534): canned owner read-model answers, keyed by query name. */
  queries?: Record<string, unknown>
  /** In-memory pins store seed (tests / local mode). */
  pins?: LocalPinsState
  acl?: Acl
}

/**
 * Entity kind the reference dispatcher reports for a known owner command.
 * `null` = the command creates no single entity (`links.add` / `links.remove`),
 * or the stub cannot guess it — the reference harness only needs the refs the
 * X-13…X-26 handlers propagate (derived-from, time-block, outcomes).
 */
const DISPATCH_RESULT_KIND: Readonly<Record<string, EntityKind | null>> = {
  'tasks.create': 'task',
  'docs.create_document': 'note',
  'docs.append_block': 'note',
  'calendar.create_event': 'calendar-event',
  'calendar.create_time_block': 'calendar-event',
  'decisions.create': 'decision',
  'drive.import_attachment': 'file',
  'im.send_message': 'channel-message',
  'tables.insert_row': 'base-record',
  'goals.create': 'goal',
  'links.add': null,
  'links.remove': null,
}

export function createXfnPorts(options: CreateXfnPortsOptions): XfnPorts {
  const journal = options.journal ?? { dispatches: [] }
  let pins = options.pins ?? EMPTY_LOCAL_PINS_STATE
  let seq = 0
  return {
    now: options.now ?? (() => new Date()),
    actor: options.actor,
    workspaceId: options.workspaceId ?? null,
    async dispatch(command, payload) {
      journal.dispatches.push({ command, payload })
      seq += 1
      const kind = DISPATCH_RESULT_KIND[command]
      return {
        ...(kind ? { ref: { kind, id: `${kind}-${seq}` } as EntityRef } : {}),
        revision: seq,
        result: command === 'docs.append_block' ? { blockId: `block-${seq}` } : { command, payload },
      }
    },
    async query(name) {
      return options.queries?.[name] ?? null
    },
    reminders: {
      async create(record) {
        seq += 1
        void record
        return { id: `reminder-${seq}` }
      },
      async cancel() {
        return true
      },
    },
    decisions: {
      async create(input) {
        seq += 1
        void input
        return { ref: { kind: 'decision', id: `decision-${seq}` } }
      },
    },
    tables: {
      async insertRow(input) {
        seq += 1
        const rowId = String(input.row.id ?? `row-${seq}`)
        return { ref: { kind: 'base-record', id: rowId }, rowId }
      },
    },
    calls: {
      async startMeeting() {
        seq += 1
        return { ref: { kind: 'call', id: `call-${seq}` } }
      },
    },
    pins: {
      async load() {
        return pins
      },
      async save(state) {
        pins = state
      },
      async record(refs) {
        pins = recordLocalPins(pins, refs, (options.now ?? (() => new Date()))().toISOString())
      },
    },
    ...(options.acl ? { acl: options.acl } : {}),
  }
}

/** Workspace pins, owner-filtered and ordered by anchor (X-26 read model). */
export function visiblePins(links: readonly PinLink[], viewerPrincipalId: string): PinLink[] {
  return sortPins(links.filter((link) => link.createdBy === viewerPrincipalId))
}