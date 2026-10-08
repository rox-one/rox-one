/**
 * W1-15 (#1512) — Cross-functional capability contracts X-13…X-26
 * (TECH-SPEC §20, UI-SPEC §28, PRD M26).
 *
 * Every entry point asks the registry for `{available, reason}` (W1-03
 * discovery). With `xfn.capabilities.v1` off — or the owner module's flag off
 * — the entry is hidden: the reference handlers implement the *decision*
 * logic, never a bypass of the command bus, ACL, risk classes or approvals.
 *
 * No `xfn.*` domain events are added: the resolved owner commands emit their
 * usual events, so activity and notifications need no new types beyond
 * `reminder_due` (W1-09 #1506, referenced here). The one exception is pins
 * (X-26): a pin is private to `created_by`, so a pin link emits nothing that
 * others could observe (see `acl/rules/pin-private.ts`).
 *
 * Dependency-free: zod schemas are bound from `@rox/shared/xfn/schemas` (as
 * with the rest of the catalogue) and every write goes through `XfnPorts`.
 */

import type { EntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import { formatEntityRef, parseEntityRef, entityRefKey } from '../entities/refs.ts'
import { isEntityKind } from '../entities/kinds.ts'
import type { CommandType } from '../commands/envelope.ts'
import type {
  CommandHandler,
  CommandHandlerContext,
  CommandHandlerResult,
  CommandRegistry,
  CommandRiskContext,
  RiskClass,
} from '../commands/registry.ts'
import type { SchemaLike } from '../commands/registry.ts'
import type { DomainEventDraft } from '../events/types.ts'
import { EMPTY_LOCAL_PINS_STATE, pinAnchorsForOrder, recordLocalPins, withoutLocalPin, withLocalPin } from '../acl/rules/pin-private.ts'
import { REMINDER_DUE_KIND, REMINDER_SCHEMA_VERSION, reminderDueNotification, type ReminderRecord } from './reminder.ts'
import type { XfnPorts } from './ports.ts'

// ---------------------------------------------------------------------------
// Capability catalogue
// ---------------------------------------------------------------------------

export const XFN_IDS = [
  'X-13', 'X-14', 'X-15', 'X-16', 'X-17', 'X-18', 'X-19',
  'X-20', 'X-21', 'X-22', 'X-23', 'X-24', 'X-25', 'X-26',
] as const
export type XfnId = (typeof XFN_IDS)[number]

/** One capability row: what it dispatches, who owns it and who replaces the reference handler. */
export interface XfnCapability {
  id: XfnId
  /**
   * Entry points whose contract this package owns — every one needs an XFN
   * schema (`XFN_SCHEMAS`) and a risk class.
   */
  commands: readonly CommandType[]
  /**
   * Owner commands a reference handler dispatches internally (X-15, X-22,
   * X-24…). Their schemas belong to the owner module; XFN never binds them.
   */
  dispatches?: readonly CommandType[]
  /** Read models — never commands (the catalogue test asserts they are absent). */
  queries: readonly string[]
  /** UI entry points — a renderer action, not a bus command. */
  uiCommands: readonly string[]
  ownerModule: string
  /** `as the resolved command` for X-13, `per item` for X-19, `—` for queries. */
  risk: RiskClass | 'as-resolved' | 'max-of-items' | 'own-else-consequential' | 'none'
  undo: string
  titleKey: string
  /** Wave-2 package that replaces the reference handler (§20 owner module). */
  replacedBy: string
}

/** TECH-SPEC §20, row for row. */
export const XFN_CAPABILITIES: readonly XfnCapability[] = [
  {
    id: 'X-13', commands: ['entities.drop'], queries: [], uiCommands: [],
    ownerModule: 'core', risk: 'as-resolved', undo: 'via the resolved command',
    titleKey: 'xfn.x13.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-14', commands: ['calendar.create_time_block'], dispatches: ['calendar.create_event', 'links.add'], queries: [], uiCommands: [],
    ownerModule: 'calendar', risk: 'routine', undo: 'yes',
    titleKey: 'xfn.x14.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-15', commands: ['meetings.publish_outcomes', 'decisions.create'], dispatches: ['tasks.create', 'docs.append_block', 'im.send_message'],
    queries: [], uiCommands: [], ownerModule: 'meetings', risk: 'consequential', undo: 'per created item',
    titleKey: 'xfn.x15.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-16', commands: ['reminders.create', 'reminders.cancel'], queries: [], uiCommands: [],
    ownerModule: 'tasks', risk: 'routine', undo: 'yes',
    titleKey: 'xfn.x16.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-17', commands: ['checkins.draft_from_activity'], queries: [], uiCommands: [],
    ownerModule: 'goals', risk: 'routine', undo: '—',
    titleKey: 'xfn.x17.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-18', commands: ['goals.link_work', 'goals.unlink_work'], dispatches: ['links.add', 'links.remove'], queries: [], uiCommands: [],
    ownerModule: 'goals', risk: 'own-else-consequential', undo: 'yes',
    titleKey: 'xfn.x18.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-19', commands: ['commands.batch'], queries: [], uiCommands: [],
    ownerModule: 'core', risk: 'max-of-items', undo: 'yes (group)',
    titleKey: 'xfn.x19.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-20', commands: [], queries: ['people.get_overview'], uiCommands: [],
    ownerModule: 'contacts', risk: 'none', undo: '—',
    titleKey: 'xfn.x20.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-21', commands: [], queries: ['agenda.today'], uiCommands: [],
    ownerModule: 'core', risk: 'none', undo: '—',
    titleKey: 'xfn.x21.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-22',
    commands: ['tasks.create_from_email', 'calendar.create_event_from_email', 'docs.create_from_email', 'im.share_entity'],
    dispatches: ['tasks.create', 'calendar.create_event', 'docs.create_document', 'im.send_message', 'drive.import_attachment', 'links.add'],
    queries: [], uiCommands: [], ownerModule: 'tasks', risk: 'consequential', undo: 'yes',
    titleKey: 'xfn.x22.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-23', commands: ['forms.configure_on_submit', 'tables.insert_row'], dispatches: ['tasks.create', 'im.send_message'], queries: [], uiCommands: [],
    ownerModule: 'forms', risk: 'consequential', undo: 'per action',
    titleKey: 'xfn.x23.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-24', commands: ['vc.start_meeting'], dispatches: ['links.add'], queries: [], uiCommands: [],
    ownerModule: 'meetings', risk: 'consequential', undo: 'end call',
    titleKey: 'xfn.x24.title', replacedBy: 'XFN (#1534)',
  },
  {
    id: 'X-25', commands: [], queries: [], uiCommands: ['agents.panel_open'],
    ownerModule: 'agent-panel', risk: 'none', undo: '—',
    titleKey: 'xfn.x25.title', replacedBy: 'AGP (#1532)',
  },
  {
    id: 'X-26', commands: ['entities.pin', 'entities.unpin', 'entities.reorder_pins'], dispatches: ['links.add', 'links.remove'], queries: [], uiCommands: [],
    ownerModule: 'core', risk: 'routine', undo: 'yes',
    titleKey: 'xfn.x26.title', replacedBy: 'XFN (#1534)',
  },
]

export function xfnCapability(id: XfnId): XfnCapability {
  const found = XFN_CAPABILITIES.find((entry) => entry.id === id)
  if (!found) throw new Error(`Unknown cross-functional capability: ${String(id)}`)
  return found
}

/** Every domain command X-13…X-26 dispatches as an entry point (the binding target list). */
export const XFN_COMMAND_NAMES: readonly CommandType[] = [
  ...new Set(XFN_CAPABILITIES.flatMap((entry) => entry.commands)),
].sort()

/**
 * Owner commands the reference handlers dispatch internally. Their contract
 * (schema, risk class, handler) belongs to the owner module — XFN never binds
 * them; the list exists so the harness can assert the dispatch surface.
 */
export const XFN_DISPATCHED_COMMANDS: readonly CommandType[] = [
  ...new Set(XFN_CAPABILITIES.flatMap((entry) => entry.dispatches ?? [])),
].sort()

/** Read models: never registered as commands. */
export const XFN_QUERY_NAMES: readonly string[] = [...new Set(XFN_CAPABILITIES.flatMap((entry) => entry.queries))].sort()

/** UI entry points: renderer actions. */
export const XFN_UI_COMMAND_NAMES: readonly string[] = [...new Set(XFN_CAPABILITIES.flatMap((entry) => entry.uiCommands))].sort()

/** The capability that owns a command, or undefined for a command outside XFN. */
export function xfnCapabilityForCommand(command: string): XfnCapability | undefined {
  return XFN_CAPABILITIES.find((entry) => (entry.commands as readonly string[]).includes(command))
}

/** Flag that gates every entry point (TECH-SPEC §20 «Capability discovery»). */
export const XFN_CAPABILITIES_WORKBENCH_FLAG = 'xfn.capabilities.v1'

export type XfnCapabilityReason =
  | 'flag_off'
  | 'module_off'
  | 'not_bound'
  | 'disabled'
  | 'unknown_command'
  | 'unknown_pair'
  | 'mixed_intent'
  | 'invalid_kind'
  | 'unavailable'

export interface XfnAvailability {
  available: boolean
  reason?: XfnCapabilityReason
}

/** Discover one command through the registry, translating W1-03 reasons. */
export function commandAvailability(registry: CommandRegistry, command: CommandType): XfnAvailability {
  const capability = registry.capability(command)
  if (capability.available) return { available: true }
  return { available: false, reason: capability.reason ?? 'unavailable' }
}

/** Discover every command of a capability; the first unavailable one decides. */
export function xfnAvailability(
  registry: CommandRegistry,
  id: XfnId,
  /** Flag source, required for X-20 / X-21 / X-25 — they have no command to discover through. */
  flags?: { isFlagEnabled(flag: string): boolean },
): XfnAvailability {
  const capability = xfnCapability(id)
  if (capability.commands.length === 0) {
    if (!flags) return { available: false, reason: 'unavailable' }
    return flags.isFlagEnabled(XFN_CAPABILITIES_WORKBENCH_FLAG)
      ? { available: true }
      : { available: false, reason: 'flag_off' }
  }
  for (const command of capability.commands) {
    const availability = commandAvailability(registry, command)
    if (!availability.available) return availability
  }
  return { available: true }
}

// ---------------------------------------------------------------------------
// Risk classes (TECH-SPEC §20 «Risk class (agent)» column)
// ---------------------------------------------------------------------------

/**
 * Extra risk inputs the policy middleware (W1-11 #1508) may supply. An absent
 * `owns` fails safe to `consequential`, so an agent never auto-links work it
 * may not own without an approval.
 */
export interface XfnRiskContext extends CommandRiskContext {
  owns?: (ref: EntityRef) => boolean
}

/** Type → risk resolver used by X-19; the host wires it to the command registry. */
export type XfnRiskResolver = (type: string, payload: unknown, ctx: XfnRiskContext) => RiskClass | undefined

let riskResolver: XfnRiskResolver | undefined

/** Wire the batch risk resolver to the registry (one-line host setup). */
export function setXfnRiskResolver(next: XfnRiskResolver | undefined): void {
  riskResolver = next
}

/** Registry-backed resolver, ready for `setXfnRiskResolver`. */
export function registryRiskResolver(registry: CommandRegistry): XfnRiskResolver {
  return (type, payload, ctx) => registry.get(type)?.riskClass?.(payload, ctx)
}

const MAX_RISK: Readonly<Record<RiskClass, number>> = { routine: 0, consequential: 1, privileged: 2 }

export function maxRiskClass(left: RiskClass | undefined, right: RiskClass | undefined): RiskClass | undefined {
  if (!left) return right
  if (!right) return left
  return MAX_RISK[left] >= MAX_RISK[right] ? left : right
}

function hasExplicitAttendees(attendees: unknown): boolean {
  if (Array.isArray(attendees)) return attendees.length > 0
  return attendees === 'sender' || attendees === 'participants'
}

function hasAssignedOther(payload: { assignee?: EntityRef }, actorId: string): boolean {
  return !!payload.assignee && payload.assignee.id !== actorId
}

/**
 * Risk classes for the X-13…X-26 commands, keyed by command name. Bind them
 * with `bindXfnContracts`; they are also exported for the matrix tests.
 */
export const XFN_RISK_CLASSES: Readonly<Record<string, ((payload: never, ctx: XfnRiskContext) => RiskClass) | undefined>> = {
  // X-13 resolves to one owner command; the dispatcher re-dispatches, so the
  // resolved command's own class is what the policy middleware sees then.
  'entities.drop': () => 'routine',
  // X-19 is as strict as its strictest item (fail safe on an unknown type).
  'commands.batch': (payload: { commands?: Array<{ type: string; payload: unknown; target?: EntityRef }> }, ctx) => {
    let worst: RiskClass = 'routine'
    for (const item of payload?.commands ?? []) {
      const resolved = riskResolver?.(item.type, item.payload, { ...ctx, ...(item.target ? { target: item.target } : {}) })
      worst = maxRiskClass(worst, resolved ?? 'consequential') ?? worst
    }
    return worst
  },
  // X-14: routine — a time block on your own task.
  'calendar.create_time_block': () => 'routine',
  // X-15 assigns others and posts: consequential.
  'meetings.publish_outcomes': () => 'consequential',
  // X-16: routine — a personal reminder.
  'reminders.create': () => 'routine',
  'reminders.cancel': () => 'routine',
  // X-17 returns a draft, writes nothing.
  'checkins.draft_from_activity': () => 'routine',
  // X-18: routine on your own work, consequential on someone else's.
  'goals.link_work': (payload: { workRef?: EntityRef }, ctx) => (payload?.workRef && ctx.owns?.(payload.workRef) ? 'routine' : 'consequential'),
  'goals.unlink_work': (payload: { workRef?: EntityRef }, ctx) => (payload?.workRef && ctx.owns?.(payload.workRef) ? 'routine' : 'consequential'),
  // X-22: routine unless the command touches other people.
  'tasks.create_from_email': (payload: { assignee?: EntityRef }, ctx) => (hasAssignedOther(payload ?? {}, ctx.actor.principalId) ? 'consequential' : 'routine'),
  'calendar.create_event_from_email': (payload: { attendees?: unknown }) => (hasExplicitAttendees(payload?.attendees) ? 'consequential' : 'routine'),
  'docs.create_from_email': () => 'routine',
  'im.share_entity': () => 'routine',
  // X-23 configuring: consequential. The runtime per-response dispatch uses
  // the target command's own class (see `formResponseActionRisk`).
  'forms.configure_on_submit': () => 'consequential',
  'tables.insert_row': () => 'routine',
  'decisions.create': () => 'routine',
  // X-24 invitations: consequential; an empty invite list is routine.
  'vc.start_meeting': (payload: { invite?: readonly string[] }) => (payload?.invite && payload.invite.length > 0 ? 'consequential' : 'routine'),
  // X-26 pins are the user's own bookkeeping.
  'entities.pin': () => 'routine',
  'entities.unpin': () => 'routine',
  'entities.reorder_pins': () => 'routine',
}

/**
 * Risk class of one configured form action at response time (X-23). The
 * per-response dispatch is not a user action, so an unresolved class fails
 * safe to `consequential` (the form owner gets an approval, not a silent write).
 */
export function formResponseActionRisk(kind: 'tasks.create' | 'tables.insert_row' | 'im.send_message'): RiskClass {
  if (kind === 'tables.insert_row' && !riskResolver) return 'routine'
  return riskResolver?.(kind, undefined, { workspaceId: '', actor: { principalId: '', kind: 'agent' } }) ?? 'consequential'
}

/** Idempotency key of one form action at response time (X-23). */
export function formActionIdempotencyKey(formResponseId: string, actionIndex: number): string {
  if (!formResponseId) throw new Error('formActionIdempotencyKey needs a form response id')
  if (!Number.isInteger(actionIndex) || actionIndex < 0) throw new Error('actionIndex must be a non-negative integer')
  return `${formResponseId}:${actionIndex}`
}

// ---------------------------------------------------------------------------
// X-13 drop resolution
// ---------------------------------------------------------------------------

export interface DropRule {
  sources: readonly EntityKind[]
  targets: readonly EntityKind[]
  command: CommandType
  /** Hint passed to the resolved command (`attach`, `move`, `link`, `schedule`). */
  intent: string
}

/**
 * `(sourceKind, targetKind)` → owner command (TECH-SPEC §20 X-13). Pairs not
 * listed here are `available: false, reason: 'unknown_pair'` — the drop
 * affordance must not invent a command.
 */
export const DROP_RULES: readonly DropRule[] = [
  { sources: ['channel-message', 'mail-thread'], targets: ['task-list', 'project'], command: 'tasks.create_from_message', intent: 'move' },
  { sources: ['task'], targets: ['calendar', 'calendar-event'], command: 'calendar.create_time_block', intent: 'schedule' },
  { sources: ['task'], targets: ['task-list'], command: 'tasks.add_to_list', intent: 'move' },
  { sources: ['task', 'goal', 'kpi', 'project'], targets: ['goal'], command: 'goals.link_work', intent: 'link' },
  { sources: ['goal', 'kpi', 'project'], targets: ['space'], command: 'links.add', intent: 'attach' },
  { sources: ['note', 'file', 'drive-link'], targets: ['task', 'goal', 'project', 'space'], command: 'links.add', intent: 'attach' },
  { sources: ['note', 'file'], targets: ['channel'], command: 'im.share_entity', intent: 'attach' },
  { sources: ['file'], targets: ['folder'], command: 'drive.move_items', intent: 'move' },
]

export interface DropResolution {
  available: boolean
  command?: CommandType
  intent?: string
  reason?: XfnCapabilityReason
  /** Source refs that had no rule for the target (only when unavailable). */
  unresolved?: EntityRef[]
}

/** Resolve a drop for one source against one target. */
export function resolveDrop(source: EntityRef, target: EntityRef, intent?: string): DropResolution {
  const rule = DROP_RULES.find(
    (candidate) => candidate.sources.includes(source.kind) && candidate.targets.includes(target.kind),
  )
  if (!rule) return { available: false, reason: 'unknown_pair' }
  return { available: true, command: rule.command, intent: intent ?? rule.intent }
}

/**
 * Resolve a multi-source drop. Every source must resolve to the SAME command;
 * a mixed drop is `mixed_intent` (the caller falls back to «Создать…»), an
 * unknown source is `unknown_pair`.
 */
export function resolveDropMany(sources: readonly EntityRef[], target: EntityRef, intent?: string): DropResolution {
  if (sources.length === 0) return { available: false, reason: 'invalid_kind' }
  const first = resolveDrop(sources[0]!, target, intent)
  if (!first.available) return { ...first, unresolved: [sources[0]!] }
  const unresolved: EntityRef[] = []
  for (const source of sources.slice(1)) {
    const next = resolveDrop(source, target, intent)
    if (!next.available) { unresolved.push(source); continue }
    if (next.command !== first.command) return { available: false, reason: 'mixed_intent', unresolved }
  }
  if (unresolved.length > 0) return { available: false, reason: 'unknown_pair', unresolved }
  return first
}

// ---------------------------------------------------------------------------
// Reference handlers
// ---------------------------------------------------------------------------

/** Payload of the X-13 command, validated by `@rox/shared/xfn/schemas`. */
interface DropPayload { source: EntityRef[]; target: EntityRef; intent?: string }
interface BatchPayload { commands: Array<{ type: string; payload: unknown; target?: EntityRef }>; label: string }
interface PinPayload { ref: EntityRef }
interface ReorderPinsPayload { refs: EntityRef[] }
interface TimeBlockPayload { taskRef: EntityRef; start: string; end: string; title?: string }
interface ReminderCreateHandle { id: string }

/** Receipt result of an X-13 dispatch (never an error: availability is data). */
export interface DropDispatchResult {
  available: boolean
  reason?: XfnCapabilityReason
  command?: CommandType
  intent?: string
  source: EntityRef[]
  target: EntityRef
  unresolved?: EntityRef[]
}

export interface XfnReferenceHandlersOptions {
  ports: XfnPorts
  /** Whether `xfn.capabilities.v1` is on; off → every handler refuses with `flag_off`. */
  enabled: boolean
}

/** Captured references to the local principal used by table-free commands. */
export function localActorRef(principalId: string): EntityRef {
  return { kind: 'person', id: principalId }
}

/** Thrown by every reference handler while `xfn.capabilities.v1` is off. */
export class XfnFlagOffError extends Error {
  constructor(command: string) {
    super(`xfn.capabilities.v1 is off; ${command} is not available`)
    this.name = 'XfnFlagOffError'
  }
}

/**
 * Reference handlers for X-13…X-26 (TECH-SPEC §20). They implement the
 * decision logic and hand every write to `XfnPorts`; the owner module replaces
 * the handler through `registry.bind` (XFN #1534).
 */
export function xfnReferenceHandlers(options: XfnReferenceHandlersOptions): Record<string, CommandHandler<never, unknown>> {
  const { ports } = options
  const enabled = options.enabled

  const handlers: Record<string, CommandHandler<never, unknown>> = {
    // X-13 — pure resolution; the dispatcher re-dispatches the resolved command.
    'entities.drop': (ctx) => {
      const payload = ctx.payload as DropPayload
      const resolution = resolveDropMany(payload.source, payload.target, payload.intent)
      const result: DropDispatchResult = {
        ...resolution,
        source: payload.source,
        target: payload.target,
      }
      return { result }
    },

    // X-19 — one batch id, one undo group, per-item receipts.
    'commands.batch': async (ctx) => {
      const payload = ctx.payload as BatchPayload
      const batchId = ctx.envelope.correlationId ?? ctx.envelope.commandId
      const items: Array<{ type: string; status: 'applied' | 'rejected'; error?: string }> = []
      const results: unknown[] = []
      for (const item of payload.commands) {
        const commandType = item.type as CommandType
        try {
          const written = await ports.dispatch(commandType, item.payload, {
            ...ctx,
            envelope: { ...ctx.envelope, type: commandType, payload: item.payload, ...(item.target ? { target: item.target } : {}) },
            payload: item.payload,
          })
          items.push({ type: item.type, status: 'applied' })
          results.push(written.result ?? null)
        } catch (error) {
          items.push({ type: item.type, status: 'rejected', error: (error as Error).message })
        }
      }
      const failed = items.filter((item) => item.status === 'rejected').length
      return {
        result: { batchId, label: payload.label, items, results, failed, undoGroup: batchId },
      }
    },

    // X-26 — pins: local file in local-only mode, `entity_link` in a workspace.
    // No domain event: a pin is private to `created_by` (ACL rule `pin-private`).
    'entities.pin': async (ctx) => {
      const payload = ctx.payload as PinPayload
      const at = ports.now().toISOString()
      if (ports.workspaceId === null) {
        const state = await ports.pins.load()
        const position = state.pins.length
        await ports.pins.save(withLocalPin(state, payload.ref, at))
        return { ref: payload.ref, result: { pinned: true, position } }
      }
      await ports.dispatch('links.add', {
        from: localActorRef(ports.actor.onBehalfOf ?? ports.actor.principalId),
        to: payload.ref,
        relation: 'relates-to',
        role: 'pin',
        anchor: { position: await nextPinPosition(ports) },
      }, ctx)
      return { ref: payload.ref, result: { pinned: true } }
    },
    'entities.unpin': async (ctx) => {
      const payload = ctx.payload as PinPayload
      if (ports.workspaceId === null) {
        await ports.pins.save(withoutLocalPin(await ports.pins.load(), payload.ref))
        return { ref: payload.ref, result: { pinned: false } }
      }
      await ports.dispatch('links.remove', {
        from: localActorRef(ports.actor.onBehalfOf ?? ports.actor.principalId),
        to: payload.ref,
        relation: 'relates-to',
        role: 'pin',
      }, ctx)
      return { ref: payload.ref, result: { pinned: false } }
    },
    'entities.reorder_pins': async (ctx) => {
      const payload = ctx.payload as ReorderPinsPayload
      const ordered = pinAnchorsForOrder(payload.refs)
      if (ports.workspaceId === null) {
        const state = await ports.pins.load()
        await ports.pins.save(recordLocalPins(state, payload.refs, ports.now().toISOString()))
        return { result: { order: ordered.map((entry) => formatEntityRef(entry.ref)) } }
      }
      for (const entry of ordered) {
        await ports.dispatch('links.add', {
          from: localActorRef(ports.actor.onBehalfOf ?? ports.actor.principalId),
          to: entry.ref,
          relation: 'relates-to',
          role: 'pin',
          anchor: entry.anchor,
        }, ctx)
      }
      return { result: { order: ordered.map((entry) => formatEntityRef(entry.ref)) } }
    },

    // X-14 — time block on a task.
    'calendar.create_time_block': async (ctx) => {
      const payload = ctx.payload as TimeBlockPayload
      if (payload.taskRef.kind !== 'task') throw new Error('calendar.create_time_block needs a task ref')
      const created = await ports.dispatch('calendar.create_event', {
        title: payload.title ?? null,
        start: payload.start,
        end: payload.end,
        showAs: 'busy',
        originRef: formatEntityRef(payload.taskRef),
      }, ctx)
      const eventRef = created.ref ?? null
      if (eventRef) {
        await ports.dispatch('links.add', {
          from: payload.taskRef,
          to: eventRef,
          relation: 'in-calendar',
          role: 'time-block',
        }, ctx)
      }
      return {
        ...(eventRef ? { ref: eventRef } : {}),
        result: { eventRef, linked: !!eventRef, showAs: 'busy' },
      }
    },

    // X-15 — publish meeting outcomes.
    'meetings.publish_outcomes': async (ctx) => {
      const payload = ctx.payload as {
        callId: string
        decisions: Array<{ title: string; body?: string }>
        tasks: Array<{ title: string; assignee?: EntityRef; due?: string; description?: string }>
        summary: string
        minutesRef?: EntityRef
      }
      const callRef: EntityRef = { kind: 'call', id: payload.callId }
      const decisionRefs: EntityRef[] = []
      for (const decision of payload.decisions) {
        const created = await ports.dispatch('decisions.create', { ...decision, originRef: callRef }, ctx)
        if (created.ref) decisionRefs.push(created.ref)
      }
      const taskRefs: EntityRef[] = []
      for (const task of payload.tasks) {
        const created = await ports.dispatch('tasks.create', { ...task, originRef: callRef }, ctx)
        if (created.ref) taskRefs.push(created.ref)
      }
      let minutesBlockId: string | null = null
      if (payload.minutesRef) {
        const appended = await ports.dispatch('docs.append_block', { docRef: payload.minutesRef, block: { type: 'summary', text: payload.summary } }, ctx)
        minutesBlockId = (appended.result as { blockId?: string } | undefined)?.blockId ?? null
      }
      const events: DomainEventDraft[] = []
      return {
        ref: callRef,
        result: { decisionRefs, taskRefs, minutesBlockId, summary: payload.summary },
        ...(events.length ? { events } : {}),
      }
    },

    // X-16 — reminders with the new `subjectRef`.
    'reminders.create': async (ctx) => {
      const payload = ctx.payload as { subjectRef: EntityRef; at: string; note?: string; deliver?: readonly ('inbox' | 'os')[] }
      const record: ReminderRecord = {
        id: `${ctx.envelope.commandId}`,
        workspaceId: ports.workspaceId,
        principalId: ports.actor.onBehalfOf ?? ports.actor.principalId,
        subjectRef: payload.subjectRef,
        at: payload.at,
        ...(payload.note ? { note: payload.note } : {}),
        channels: payload.deliver ?? ['inbox', 'os'],
        schemaVersion: REMINDER_SCHEMA_VERSION,
        createdAt: ports.now().toISOString(),
        updatedAt: ports.now().toISOString(),
      }
      const created: ReminderCreateHandle = await ports.reminders.create(record)
      return { result: { id: created.id, subjectRef: payload.subjectRef, at: payload.at, notificationKind: REMINDER_DUE_KIND } }
    },
    'reminders.cancel': async (ctx) => {
      const payload = ctx.payload as { id: string }
      const cancelled = await ports.reminders.cancel(payload.id)
      return { result: { id: payload.id, cancelled } }
    },

    // X-17 — a draft, no writes.
    'checkins.draft_from_activity': async (ctx) => {
      const payload = ctx.payload as { subjectRef: EntityRef; since: string; authorRef?: EntityRef }
      const activity = await ports.query('checkins.activity', { subjectRef: payload.subjectRef, since: payload.since, authorRef: payload.authorRef })
      return {
        ref: payload.subjectRef,
        result: {
          draft: true,
          subjectRef: payload.subjectRef,
          since: payload.since,
          activity: activity ?? [],
          writes: 0,
        },
      }
    },

    // X-18 — linked work.
    'goals.link_work': async (ctx) => {
      const payload = ctx.payload as { goalRef: EntityRef; workRef: EntityRef; relation?: 'aligned-to' | 'member-of'; role?: 'okr-of' }
      const pair = goalWorkRelation(payload.goalRef, payload.workRef, payload.relation)
      if (!pair.relation) return { result: { linked: false, reason: 'invalid_kind' } }
      await ports.dispatch('links.add', {
        from: payload.workRef,
        to: payload.goalRef,
        relation: pair.relation,
        ...(payload.role ? { role: payload.role } : {}),
      }, ctx)
      return { ref: payload.workRef, result: { linked: true, relation: pair.relation } }
    },
    'goals.unlink_work': async (ctx) => {
      const payload = ctx.payload as { goalRef: EntityRef; workRef: EntityRef; relation?: 'aligned-to' | 'member-of' }
      const pair = goalWorkRelation(payload.goalRef, payload.workRef, payload.relation)
      if (!pair.relation) return { result: { linked: false, reason: 'invalid_kind' } }
      await ports.dispatch('links.remove', { from: payload.workRef, to: payload.goalRef, relation: pair.relation }, ctx)
      return { ref: payload.workRef, result: { linked: false, relation: pair.relation } }
    },

    // X-22 — create from email.
    'tasks.create_from_email': async (ctx) => {
      const payload = ctx.payload as { messageRef: EntityRef; title?: string; assignee?: EntityRef; due?: string; listRef?: EntityRef; description?: string }
      const derived = await ports.dispatch('tasks.create', {
        title: payload.title ?? null,
        ...(payload.assignee ? { assigneeIds: [payload.assignee.id] } : {}),
        ...(payload.due ? { deadlineAt: payload.due } : {}),
        ...(payload.listRef ? { listRef: payload.listRef } : {}),
        ...(payload.description ? { description: payload.description } : {}),
      }, ctx)
      await dispatchDerivedFrom(ports, derived.ref, payload.messageRef, ctx)
      return { ...(derived.ref ? { ref: derived.ref } : {}), result: { derivedFrom: formatEntityRef(payload.messageRef) } }
    },
    'calendar.create_event_from_email': async (ctx) => {
      const payload = ctx.payload as { messageRef: EntityRef; title?: string; start?: string; end?: string; attendees: unknown; call?: boolean }
      const created = await ports.dispatch('calendar.create_event', {
        title: payload.title ?? null,
        ...(payload.start ? { start: payload.start } : {}),
        ...(payload.end ? { end: payload.end } : {}),
        attendees: payload.attendees,
        call: payload.call === true,
      }, ctx)
      await dispatchDerivedFrom(ports, created.ref, payload.messageRef, ctx)
      return { ...(created.ref ? { ref: created.ref } : {}), result: { derivedFrom: formatEntityRef(payload.messageRef) } }
    },
    'docs.create_from_email': async (ctx) => {
      const payload = ctx.payload as { messageRef: EntityRef; title?: string; folderRef?: EntityRef; wholeThread?: boolean }
      const created = await ports.dispatch('docs.create_document', {
        title: payload.title ?? null,
        ...(payload.folderRef ? { folderRef: payload.folderRef } : {}),
        wholeThread: payload.wholeThread === true,
      }, ctx)
      await dispatchDerivedFrom(ports, created.ref, payload.messageRef, ctx)
      return { ...(created.ref ? { ref: created.ref } : {}), result: { derivedFrom: formatEntityRef(payload.messageRef) } }
    },
    'im.share_entity': async (ctx) => {
      const payload = ctx.payload as { ref: EntityRef; chatRef: EntityRef; comment?: string; importAttachments?: boolean }
      const attachments = await ports.query('mail.attachments', { messageRef: payload.ref })
      const imported: EntityRef[] = []
      if (payload.importAttachments && Array.isArray(attachments)) {
        for (const attachment of attachments as EntityRef[]) {
          const importedFile = await ports.dispatch('drive.import_attachment', { attachmentRef: attachment, originRef: payload.ref }, ctx)
          if (importedFile.ref) imported.push(importedFile.ref)
        }
      }
      const sent = await ports.dispatch('im.send_message', {
        chatRef: payload.chatRef,
        entityRef: payload.ref,
        ...(payload.comment ? { comment: payload.comment } : {}),
        attachments: imported,
      }, ctx)
      return { result: { shared: true, attachments: imported.map(formatEntityRef), message: sent.result ?? null } }
    },

    // X-23 — configure form submit actions (the runtime dispatches them on
    // `forms.response_submitted`; see `formResponsePlan`).
    'forms.configure_on_submit': async (ctx) => {
      const payload = ctx.payload as { formRef: EntityRef; actions: Array<{ kind: string; config: Record<string, unknown> }> }
      const plan = formResponsePlan(payload.formRef, payload.actions)
      return { ref: payload.formRef, result: plan }
    },
    // X-23 runtime action (declared name, owned by the tables module).
    'tables.insert_row': async (ctx) => {
      const payload = ctx.payload as { baseRef: EntityRef; tableRef?: EntityRef; row: Record<string, unknown>; idempotencyKey?: string }
      const inserted = await ports.tables.insertRow({
        baseRef: payload.baseRef,
        ...(payload.tableRef ? { tableRef: payload.tableRef } : {}),
        row: payload.row,
        ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
      })
      return { ref: inserted.ref, result: { inserted: true, rowId: inserted.rowId } }
    },

    // X-15 helper: one `decision` record (kind 49, local or server store).
    'decisions.create': async (ctx) => {
      const payload = ctx.payload as { title: string; body?: string; originRef?: EntityRef; decidedAt?: string }
      const created = await ports.decisions.create(payload)
      return { ref: created.ref, result: { title: payload.title, originRef: payload.originRef ? formatEntityRef(payload.originRef) : null } }
    },

    // X-24 — start a meeting.
    'vc.start_meeting': async (ctx) => {
      const payload = ctx.payload as { origin: EntityRef; invite?: readonly string[]; eventRef?: EntityRef; notesDocRef?: EntityRef }
      const call = await ports.dispatch('vc.start_meeting', {
        originRef: payload.origin,
        invite: payload.invite ?? [],
        ...(payload.eventRef ? { eventRef: payload.eventRef } : {}),
        ...(payload.notesDocRef ? { notesDocRef: payload.notesDocRef } : {}),
      }, ctx)
      await dispatchDerivedFrom(ports, call.ref, payload.origin, ctx)
      return { ...(call.ref ? { ref: call.ref } : {}), result: { invited: payload.invite?.length ?? 0 } }
    },
  }

  // One gate for every capability: with the flag off the reference handlers
  // refuse, and W1-03 discovery already reports `flag_off` before that.
  if (!enabled) {
    return Object.fromEntries(
      Object.keys(handlers).map((name) => [name, () => { throw new XfnFlagOffError(name) }]),
    )
  }
  return handlers
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

export interface BindXfnOptions {
  /** Every command of X-13…X-26 must accept a schema; a missing one is reported. */
  schemas: Readonly<Record<string, SchemaLike<never>>>
  /** Overrides for the reference risk classes (the owner module may raise one). */
  riskClassOf?: (command: string) => ((payload: never, ctx: XfnRiskContext) => RiskClass) | undefined
}

export interface XfnBindingReport {
  /** Commands whose schema (and risk class) is now bound. */
  bound: string[]
  /** Declared names the registry does not define (catalogue drift). */
  missingCommands: string[]
  /** Declared names without a schema in `schemas`. */
  missingSchemas: string[]
  /** Commands whose risk class is bound from `XFN_RISK_CLASSES`. */
  riskBound: string[]
}

/**
 * Bind the X-13…X-26 schemas and risk classes into the registry. Never
 * defines a name: a command the catalogue already declares is *replaced*
 * through `bindSchema`, and a missing one is reported.
 */
export function bindXfnContracts(registry: CommandRegistry, options: BindXfnOptions): XfnBindingReport {
  const report: XfnBindingReport = { bound: [], missingCommands: [], missingSchemas: [], riskBound: [] }
  for (const command of XFN_COMMAND_NAMES) {
    if (!registry.has(command)) { report.missingCommands.push(command); continue }
    const schema = options.schemas[command]
    if (!schema) { report.missingSchemas.push(command); continue }
    const riskClass = options.riskClassOf?.(command) ?? XFN_RISK_CLASSES[command]
    registry.bindSchema(command, schema, riskClass ? { riskClass } : {})
    report.bound.push(command)
    if (riskClass) report.riskBound.push(command)
  }
  return report
}

/** Catalogue names X-13…X-26 declare that the registry does not define (drift alarm). */
export function unboundXfnCommands(registry: CommandRegistry): string[] {
  return XFN_COMMAND_NAMES.filter((command) => !registry.has(command))
}

/** Parse a `ref` the way the drop affordance receives it from a drag payload. */
export function parseDropRef(value: unknown): EntityRef | null {
  if (typeof value !== 'string') return null
  const parsed = parseEntityRef(value)
  return parsed.ok ? parsed.value : null
}

/** Stable key of a drop pair, for the affordance's `available` cache. */
export function dropPairKey(source: EntityRef, target: EntityRef): string {
  return `${entityRefKey(source)}->${entityRefKey(target)}`
}

/**
 * Bind the reference handlers for the commands X-13…X-26 own. Only commands
 * this module implements are bound; a name the registry does not define is
 * reported, never defined here (the catalogue owns definitions).
 */
export function bindXfnReferenceHandlers(
  registry: CommandRegistry,
  options: XfnReferenceHandlersOptions,
): { bound: string[]; missing: string[] } {
  const handlers = xfnReferenceHandlers(options)
  const bound: string[] = []
  const missing: string[] = []
  for (const [command, handler] of Object.entries(handlers)) {
    if (!registry.has(command)) { missing.push(command); continue }
    registry.bind(command, handler)
    bound.push(command)
  }
  return { bound, missing }
}

async function nextPinPosition(ports: XfnPorts): Promise<number> {
  const existing = await ports.query('entities.pins', { principalId: ports.actor.onBehalfOf ?? ports.actor.principalId })
  return Array.isArray(existing) ? existing.length : 0
}

async function dispatchDerivedFrom(ports: XfnPorts, created: EntityRef | undefined, origin: EntityRef, ctx: CommandHandlerContext<unknown>): Promise<void> {
  if (!created) return
  await ports.dispatch('links.add', { from: created, to: origin, relation: 'derived-from', role: 'origin' }, ctx)
}

/** Default relation of an X-18 pair, `null` when the pair is not linkable. */
export function goalWorkRelation(
  goalRef: EntityRef,
  workRef: EntityRef,
  requested?: 'aligned-to' | 'member-of',
): { relation: 'aligned-to' | 'member-of' | null } {
  if (requested) return { relation: requested }
  if (workRef.kind === 'task' && goalRef.kind === 'project') return { relation: 'member-of' }
  if (['goal', 'kpi', 'project'].includes(workRef.kind) && goalRef.kind === 'goal') return { relation: 'aligned-to' }
  return { relation: null }
}

/** The plan one form submit produces (X-23 runtime, idempotent per action). */
export function formResponsePlan(
  formRef: EntityRef,
  actions: readonly { kind: string; config: Record<string, unknown> }[],
): { formRef: string; actions: Array<{ kind: string; index: number; idempotencyKeyTemplate: string }> } {
  return {
    formRef: formatEntityRef(formRef),
    actions: actions.map((action, index) => ({
      kind: action.kind,
      index,
      idempotencyKeyTemplate: `\${formResponseId}:${index}`,
    })),
  }
}

/** `{ available, reason }` of one X-13 pair, for the drop affordance. */
export function dropAvailability(source: EntityRef, target: EntityRef): XfnAvailability {
  const resolution = resolveDrop(source, target)
  return resolution.available ? { available: true } : { available: false, reason: resolution.reason }
}

/** True when a kind may be a drop source or target (validated against the registry). */
export function isDropKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && isEntityKind(value)
}

export { EMPTY_LOCAL_PINS_STATE, REMINDER_DUE_KIND, reminderDueNotification }
export type { XfnPorts }