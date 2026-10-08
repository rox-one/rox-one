/**
 * W1-03 (#1500) — Command definitions and the registry with capability
 * discovery (TECH-SPEC §3.4, PLAN §1.1 mechanism 1).
 *
 * Registry API (siblings depend on exactly these names):
 * - `define(def)` rejects duplicate names;
 * - `bindSchema(type, schema, { riskClass })` lets the owning package (W1-06)
 *   replace the catalogue placeholder;
 * - `bind(type, handler)` attaches the handler (module packages);
 * - `capability(type)` / `capabilities()` derive `{ available, reason }` from
 *   the bindings plus the owner module's flag.
 *
 * Not to be confused with `platform/commands/*` (the S-04 UI command-palette
 * registry): this is the domain command bus.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { Rox2Permission } from '../rox2/platform-contract.ts'
import type { DomainEventDraft } from '../events/types.ts'
import { isCommandType, type CommandAuthorityHint, type CommandEnvelope, type CommandType } from './envelope.ts'

/**
 * Structural schema (zod-compatible) so dependency-free `@rox/core` never
 * imports zod; schemas from `@rox/shared` satisfy it.
 */
export interface SchemaLike<P> {
  safeParse(value: unknown): { success: true; data: P } | { success: false; error: unknown }
}

/** `by-target`: the target ref's authority decides (local store vs workspace). */
export type CommandAuthority = 'by-target' | 'workspace' | 'local'

/** Where a command actually executes. */
export type ExecutionAuthority = 'local' | 'workspace'

/** Agent risk class (TECH-SPEC §13.2 step 5). W1-11 makes `riskClass` required. */
export type RiskClass = 'routine' | 'consequential' | 'privileged'

export interface CommandActor {
  /** Principal id (workspace principal uuid, or `local` for the single local user). */
  principalId: string
  kind: 'user' | 'system' | 'agent'
  /** AI path: the bot principal the user acts for (TECH-SPEC §3.4). */
  onBehalfOf?: string
}

export interface CommandRiskContext {
  workspaceId: string
  actor: CommandActor
  target?: EntityRef
}

export interface CommandDefinition<P = unknown> {
  type: CommandType
  /** Owner module (catalogue file name), e.g. `tasks`, `im`, `system`. */
  module: string
  authority: CommandAuthority
  /** ACL verb checked against `target` (or the workspace when there is none). */
  verb: Rox2Permission
  schema: SchemaLike<P>
  /** `false` while the catalogue placeholder schema is in place (W1-06 replaces it). */
  schemaBound: boolean
  /** Owner module flag; when it is off the capability is `flag_off`. */
  flag?: string
  /** Optional until W1-11 (#1508) makes it required. */
  riskClass?: (payload: P, ctx: CommandRiskContext) => RiskClass
  /** Per-definition payload budget in bytes (default `DEFAULT_MAX_COMMAND_PAYLOAD_BYTES`). */
  maxPayloadBytes?: number
  mcp?: { name: string; description: string }
  larkRoute?: string
  operatelyOp?: string
  description?: string
}

/** Thrown helpers available inside a handler. */
export interface CommandHandlerContext<P = unknown> {
  envelope: CommandEnvelope<P>
  /** Payload after schema validation. */
  payload: P
  workspaceId: string
  actor: CommandActor
  authority: ExecutionAuthority
  /** Store-specific transaction handle (Postgres `TransactionSQL`, SQLite, in-memory). */
  transaction?: unknown
  /** Abort with a `conflict` receipt (expectedRevision mismatch); nothing is committed. */
  conflict(currentRevision: number, current?: unknown): never
}

export interface CommandHandlerResult<R = unknown> {
  ref?: EntityRef
  revision?: number
  result?: R
  /** Domain events written in the same transaction as the receipt. */
  events?: DomainEventDraft[]
}

export type CommandHandler<P = unknown, R = unknown> = (
  ctx: CommandHandlerContext<P>,
) => Promise<CommandHandlerResult<R>> | CommandHandlerResult<R>

export type CapabilityReason = 'unknown_command' | 'not_bound' | 'flag_off' | 'disabled'

export interface CommandCapability {
  type: CommandType
  module: string
  authority: CommandAuthority
  verb: Rox2Permission
  schemaBound: boolean
  available: boolean
  reason?: CapabilityReason
}

export class CommandRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandRegistryError'
  }
}

/** Accepts any plain JSON object; used until W1-06 binds the real schema. */
export const PLACEHOLDER_PAYLOAD_SCHEMA: SchemaLike<Record<string, unknown>> = {
  safeParse(value: unknown) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { success: false, error: new Error('Payload must be a JSON object') }
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      return { success: false, error: new Error('Payload must be a plain JSON object') }
    }
    return { success: true, data: value as Record<string, unknown> }
  },
}

export interface CommandRegistryOptions {
  /** Live owner-module flag lookup. Missing → every flagged definition is `flag_off`. */
  isFlagEnabled?: (flag: string) => boolean
}

interface Entry {
  definition: CommandDefinition<unknown>
  handler?: CommandHandler<unknown, unknown>
}

export class CommandRegistry {
  private readonly entries = new Map<string, Entry>()
  private isFlagEnabled: (flag: string) => boolean

  constructor(options: CommandRegistryOptions = {}) {
    this.isFlagEnabled = options.isFlagEnabled ?? (() => false)
  }

  /** Replace the live flag lookup (hosts re-wire it when the flag source changes). */
  setFlagSource(isFlagEnabled: (flag: string) => boolean): void {
    this.isFlagEnabled = isFlagEnabled
  }

  define<P>(definition: CommandDefinition<P>): void {
    if (!isCommandType(definition.type)) throw new CommandRegistryError(`Invalid command type: ${String(definition.type)}`)
    if (this.entries.has(definition.type)) throw new CommandRegistryError(`Duplicate command definition: ${definition.type}`)
    if (!definition.module || typeof definition.module !== 'string') throw new CommandRegistryError(`Command ${definition.type} needs an owner module`)
    if (!definition.schema || typeof definition.schema.safeParse !== 'function') {
      throw new CommandRegistryError(`Command ${definition.type} needs a schema`)
    }
    this.entries.set(definition.type, { definition: { ...definition } as CommandDefinition<unknown> })
  }

  defineAll(definitions: readonly CommandDefinition<unknown>[]): void {
    for (const definition of definitions) this.define(definition)
  }

  /** Replace the placeholder schema (and optionally set the risk class) of a defined command. */
  bindSchema<P>(type: string, schema: SchemaLike<P>, options: { riskClass?: CommandDefinition<P>['riskClass'] } = {}): void {
    const entry = this.require(type)
    if (!schema || typeof schema.safeParse !== 'function') throw new CommandRegistryError(`Invalid schema for ${type}`)
    entry.definition = {
      ...entry.definition,
      schema: schema as SchemaLike<unknown>,
      schemaBound: true,
      ...(options.riskClass ? { riskClass: options.riskClass as CommandDefinition<unknown>['riskClass'] } : {}),
    }
  }

  /** Attach a handler. A second bind for the same type is a wiring bug and throws. */
  bind<P, R>(type: string, handler: CommandHandler<P, R>): void {
    const entry = this.require(type)
    if (typeof handler !== 'function') throw new CommandRegistryError(`Invalid handler for ${type}`)
    if (entry.handler) throw new CommandRegistryError(`Handler already bound: ${type}`)
    entry.handler = handler as CommandHandler<unknown, unknown>
  }

  unbind(type: string): boolean {
    const entry = this.entries.get(type)
    if (!entry?.handler) return false
    delete entry.handler
    return true
  }

  has(type: string): boolean {
    return this.entries.has(type)
  }

  get(type: string): CommandDefinition<unknown> | undefined {
    return this.entries.get(type)?.definition
  }

  handler(type: string): CommandHandler<unknown, unknown> | undefined {
    return this.entries.get(type)?.handler
  }

  list(): CommandDefinition<unknown>[] {
    return [...this.entries.values()].map(entry => entry.definition)
  }

  /** Capability discovery for one command (PLAN §1.1: UI hides entries that are not available). */
  capability(type: string): CommandCapability | { type: string; available: false; reason: 'unknown_command' } {
    const entry = this.entries.get(type)
    if (!entry) return { type, available: false, reason: 'unknown_command' }
    return this.describe(entry)
  }

  capabilities(): CommandCapability[] {
    return [...this.entries.values()].map(entry => this.describe(entry))
  }

  private describe(entry: Entry): CommandCapability {
    const { definition } = entry
    const base = {
      type: definition.type,
      module: definition.module,
      authority: definition.authority,
      verb: definition.verb,
      schemaBound: definition.schemaBound,
    }
    if (definition.flag && !this.safeFlag(definition.flag)) return { ...base, available: false, reason: 'flag_off' }
    if (!entry.handler) return { ...base, available: false, reason: 'not_bound' }
    return { ...base, available: true }
  }

  private safeFlag(flag: string): boolean {
    try { return this.isFlagEnabled(flag) === true } catch { return false }
  }

  private require(type: string): Entry {
    const entry = this.entries.get(type)
    if (!entry) throw new CommandRegistryError(`Unknown command: ${type}`)
    return entry
  }
}

/** Routing hint passthrough type re-exported for router implementations. */
export type { CommandAuthorityHint }
