/**
 * W1-15 (#1512) acceptance — the reference handlers for X-13…X-26
 * (TECH-SPEC §20). This is the harness the package card asks for: every
 * capability is exercised end to end against the in-memory port set, with the
 * negative cases (unknown drop pair, flag off, unavailable capability) and the
 * risk classes the agent policy reads.
 */
import { describe, expect, it } from 'bun:test'
import type { EntityRef } from '../../entities/refs.ts'
import type { CommandType } from '../../commands/envelope.ts'
import { COMMAND_CATALOGUE, CommandRegistry, registerCommandCatalogue, type CommandHandlerContext, type CommandHandlerResult } from '../../commands/index.ts'
import {
  DROP_RULES,
  XFN_CAPABILITIES,
  XFN_COMMAND_NAMES,
  XFN_DISPATCHED_COMMANDS,
  XFN_IDS,
  XFN_RISK_CLASSES,
  XfnFlagOffError,
  bindXfnContracts,
  bindXfnReferenceHandlers,
  commandAvailability,
  dropAvailability,
  dropPairKey,
  formActionIdempotencyKey,
  formResponsePlan,
  goalWorkRelation,
  isDropKind,
  maxRiskClass,
  parseDropRef,
  registryRiskResolver,
  resolveDrop,
  resolveDropMany,
  setXfnRiskResolver,
  unboundXfnCommands,
  xfnAvailability,
  xfnCapability,
  xfnCapabilityForCommand,
  xfnReferenceHandlers,
  type XfnRiskContext,
} from '../commands.ts'
import { createXfnPorts, visiblePins, type XfnPorts } from '../ports.ts'
import { PIN_RELATION, type PinLink } from '../../acl/rules/pin-private.ts'

const ref = (kind: string, id: string) => ({ kind: kind as never, id })

const ACTOR = { principalId: 'me', kind: 'user' as const }

interface Harness {
  ports: XfnPorts
  registry: CommandRegistry
  calls: Array<{ command: CommandType; payload: unknown }>
  /** Run one reference handler the way the pipeline would. */
  run: (command: string, payload: unknown, over?: Partial<CommandHandlerContext<unknown>>) => Promise<CommandHandlerResult<unknown>>
}

function harness(options: { enabled?: boolean; workspaceId?: string | null } = {}): Harness {
  const calls: Array<{ command: CommandType; payload: unknown }> = []
  const workspaceId = options.workspaceId === undefined ? 'w1' : options.workspaceId
  const ports = createXfnPorts({
    actor: ACTOR,
    workspaceId,
    now: () => new Date('2026-10-08T09:00:00.000Z'),
    journal: { dispatches: calls },
    queries: { 'checkins.activity': [{ kind: 'checkin', id: 'c1' }], 'entities.pins': [{ id: 'p1' }] },
  })
  const registry = new CommandRegistry({ isFlagEnabled: (flag) => flag === 'xfn.capabilities.v1' })
  registerCommandCatalogue(registry)
  bindXfnReferenceHandlers(registry, { ports, enabled: options.enabled ?? true })
  const run = async (command: string, payload: unknown, over: Partial<CommandHandlerContext<unknown>> = {}) => {
    const handler = registry.handler(command)
    if (!handler) throw new Error(`no reference handler for ${command}`)
    return await handler({
      envelope: { commandId: 'cmd-1', idempotencyKey: 'cmd-1', type: command, payload, issuedAt: '2026-10-08T09:00:00.000Z' },
      payload,
      workspaceId: workspaceId ?? 'local',
      actor: ACTOR,
      authority: 'workspace',
      conflict: () => { throw new Error('conflict') },
      ...over,
    } as CommandHandlerContext<unknown>)
  }
  return { ports, registry, calls, run }
}

describe('W1-15 capability catalogue', () => {
  it('lists X-13…X-26 exactly once, each with a title, an owner and a wave-2 replacement', () => {
    expect(XFN_CAPABILITIES.map((entry) => entry.id)).toEqual([...XFN_IDS])
    for (const capability of XFN_CAPABILITIES) {
      expect(capability.titleKey).toBe(`xfn.${capability.id.toLowerCase().replace('-', '')}.title`)
      expect(capability.ownerModule.length).toBeGreaterThan(0)
      expect(capability.replacedBy.length).toBeGreaterThan(0)
      expect(capability.undo.length).toBeGreaterThan(0)
    }
  })

  it('maps every entry-point command back to its capability', () => {
    for (const capability of XFN_CAPABILITIES) {
      for (const command of capability.commands) {
        expect(xfnCapabilityForCommand(command)?.id).toBe(capability.id)
      }
    }
    expect(xfnCapabilityForCommand('im.send_message')).toBeUndefined()
    expect(() => xfnCapability('X-99' as never)).toThrow()
  })

  it('never declares a command twice in the catalogue, and every entry point exists there', () => {
    const names = COMMAND_CATALOGUE.map((entry) => entry.type)
    expect(new Set(names).size).toBe(names.length)
    for (const command of [...XFN_COMMAND_NAMES, ...XFN_DISPATCHED_COMMANDS]) {
      expect({ command, known: names.includes(command as never) }).toEqual({ command, known: true })
    }
  })

  it('keeps queries and the UI entry point out of the command catalogue', () => {
    const names = new Set<string>(COMMAND_CATALOGUE.map((entry) => entry.type))
    for (const query of ['agenda.today', 'people.get_overview', 'agents.panel_open']) {
      expect({ query, isCommand: names.has(query) }).toEqual({ query, isCommand: false })
    }
  })
})

describe('W1-15 X-13 drop resolution', () => {
  it('resolves the spec pairs and refuses an unknown pair', () => {
    expect(resolveDrop(ref('channel-message', 'm1'), ref('task-list', 'l1'))).toEqual({
      available: true, command: 'tasks.create_from_message', intent: 'move',
    })
    expect(resolveDrop(ref('task', 't1'), ref('calendar', 'cal1')).command).toBe('calendar.create_time_block')
    expect(resolveDrop(ref('task', 't1'), ref('task-list', 'l1')).command).toBe('tasks.add_to_list')
    expect(resolveDrop(ref('goal', 'g1'), ref('goal', 'g1')).command).toBe('goals.link_work')
    expect(resolveDrop(ref('note', 'n1'), ref('project', 'p1')).command).toBe('links.add')
    expect(resolveDrop(ref('note', 'n1'), ref('channel', 'c1')).command).toBe('im.share_entity')
    expect(resolveDrop(ref('file', 'f1'), ref('folder', 'fo1')).command).toBe('drive.move_items')

    // Unknown pairs are a capability answer, never an invented command.
    expect(resolveDrop(ref('person', 'p1'), ref('channel', 'c1'))).toEqual({ available: false, reason: 'unknown_pair' })
    expect(dropAvailability(ref('person', 'p1'), ref('channel', 'c1'))).toEqual({ available: false, reason: 'unknown_pair' })
    expect(dropAvailability(ref('task', 't1'), ref('task-list', 'l1'))).toEqual({ available: true })
  })

  it('refuses a mixed drop and reports the unresolved sources', () => {
    expect(resolveDropMany([ref('task', 't1')], ref('calendar', 'cal1'))).toEqual({
      available: true, command: 'calendar.create_time_block', intent: 'schedule',
    })
    expect(resolveDropMany([ref('task', 't1'), ref('note', 'n1')], ref('calendar', 'cal1'))).toEqual({
      available: false, reason: 'unknown_pair', unresolved: [ref('note', 'n1')],
    })
    expect(resolveDropMany([ref('task', 't1'), ref('channel-message', 'm1')], ref('task-list', 'l1'))).toEqual({
      available: false, reason: 'mixed_intent', unresolved: [],
    })
    expect(resolveDropMany([], ref('goal', 'g1'))).toEqual({ available: false, reason: 'invalid_kind' })
  })

  it('explains every rule as a known pair of kinds and has no duplicate rule', () => {
    const pairs = new Set<string>()
    for (const rule of DROP_RULES) {
      expect(rule.command).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
      for (const source of rule.sources) {
        expect(isDropKind(source)).toBe(true)
        for (const target of rule.targets) {
          expect(isDropKind(target)).toBe(true)
          const key = `${source}->${target}`
          expect({ key, seen: pairs.has(key) }).toEqual({ key, seen: false })
          pairs.add(key)
        }
      }
    }
    expect(parseDropRef('note:n1')).toEqual({ kind: 'note', id: 'n1' })
    expect(parseDropRef('nope')).toBeNull()
    expect(parseDropRef(7)).toBeNull()
    expect(dropPairKey(ref('note', 'n1'), ref('project', 'p1'))).toBe('note:n1->project:p1')
  })

  it('answers the reference handler with availability, not an error', async () => {
    const { run } = harness()
    const ok = await run('entities.drop', { source: [ref('task', 't1')], target: ref('calendar', 'cal1') })
    expect(ok).toMatchObject({ result: { available: true, command: 'calendar.create_time_block', intent: 'schedule' } })
    const unknown = await run('entities.drop', { source: [ref('person', 'p1')], target: ref('calendar', 'cal1') })
    expect(unknown).toMatchObject({ result: { available: false, reason: 'unknown_pair' } })
  })
})

describe('W1-15 X-13…X-26 reference handlers', () => {
  it('X-19 batch: one group id, per-item receipts, partial failure reported', async () => {
    const { ports, run, calls } = harness()
    const failing: XfnPorts = { ...ports, dispatch: async (command, payload, ctx) => { if (command === 'tasks.create') throw new Error('boom'); return ports.dispatch(command, payload, ctx) } }
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    bindXfnReferenceHandlers(registry, { ports: failing, enabled: true })
    const batch = await registry.handler('commands.batch')!({
      envelope: { commandId: 'c1', idempotencyKey: 'c1', correlationId: 'group-1', type: 'commands.batch', payload: {}, issuedAt: 'T' },
      payload: { commands: [{ type: 'tasks.create', payload: {} }, { type: 'goals.create', payload: {} }], label: 'Reassign' },
      workspaceId: 'w1', actor: ACTOR, authority: 'workspace', conflict: () => { throw new Error('x') },
    } as CommandHandlerContext<unknown>)
    expect(batch.result).toMatchObject({
      batchId: 'group-1', label: 'Reassign', failed: 1, undoGroup: 'group-1',
      items: [{ type: 'tasks.create', status: 'rejected', error: 'boom' }, { type: 'goals.create', status: 'applied' }],
    })
    expect(calls.map((call) => call.command)).toEqual(['goals.create'])
    const ok = await run('commands.batch', { commands: [{ type: 'goals.create', payload: {} }], label: 'One' })
    expect(ok.result).toMatchObject({ failed: 0, batchId: 'cmd-1' })
  })

  it('X-26 pins: local file in local-only mode, entity_link in a workspace, never an event', async () => {
    const local = harness({ workspaceId: null })
    const pinned = await local.run('entities.pin', { ref: ref('goal', 'g1') })
    expect(pinned).toMatchObject({ ref: ref('goal', 'g1'), result: { pinned: true, position: 0 } })
    expect(await local.ports.pins.load()).toMatchObject({ pins: [{ ref: ref('goal', 'g1'), position: 0 }] })
    expect(local.calls).toEqual([])
    const unpinned = await local.run('entities.unpin', { ref: ref('goal', 'g1') })
    expect(unpinned).toMatchObject({ result: { pinned: false } })
    expect((await local.ports.pins.load()).pins).toEqual([])

    const workspace = harness()
    await workspace.run('entities.pin', { ref: ref('goal', 'g1') })
    await workspace.run('entities.reorder_pins', { refs: [ref('task', 't1'), ref('goal', 'g1')] })
    await workspace.run('entities.unpin', { ref: ref('goal', 'g1') })
    expect(workspace.calls).toEqual([
      { command: 'links.add', payload: { from: { kind: 'person', id: 'me' }, to: ref('goal', 'g1'), relation: 'relates-to', role: 'pin', anchor: { position: 1 } } },
      { command: 'links.add', payload: { from: { kind: 'person', id: 'me' }, to: ref('task', 't1'), relation: 'relates-to', role: 'pin', anchor: { position: 0 } } },
      { command: 'links.add', payload: { from: { kind: 'person', id: 'me' }, to: ref('goal', 'g1'), relation: 'relates-to', role: 'pin', anchor: { position: 1 } } },
      { command: 'links.remove', payload: { from: { kind: 'person', id: 'me' }, to: ref('goal', 'g1'), relation: 'relates-to', role: 'pin' } },
    ])
  })

  it('X-14 time block: calendar event + the in-calendar link, and only for a task', async () => {
    const { run, calls } = harness()
    const result = await run('calendar.create_time_block', { taskRef: ref('task', 't1'), start: '2026-10-08T09:00:00.000Z', end: '2026-10-08T10:00:00.000Z' })
    expect(calls).toEqual([
      { command: 'calendar.create_event', payload: { title: null, start: '2026-10-08T09:00:00.000Z', end: '2026-10-08T10:00:00.000Z', showAs: 'busy', originRef: 'task:t1' } },
      { command: 'links.add', payload: { from: ref('task', 't1'), to: ref('calendar-event', 'calendar-event-1'), relation: 'in-calendar', role: 'time-block' } },
    ])
    expect(result).toMatchObject({ result: { showAs: 'busy', linked: true } })
    await expect(run('calendar.create_time_block', { taskRef: ref('note', 'n1'), start: 'S', end: 'E' })).rejects.toThrow(/task ref/)
  })

  it('X-15 outcomes: decisions, tasks, minutes block and the derived call ref', async () => {
    const { run, calls } = harness()
    const result = await run('meetings.publish_outcomes', {
      callId: 'call-1',
      decisions: [{ title: 'Do it' }],
      tasks: [{ title: 'Follow up', assignee: ref('person', 'p2') }],
      summary: 'Итоги',
      minutesRef: ref('note', 'n1'),
    })
    expect(calls.map((call) => call.command)).toEqual(['decisions.create', 'tasks.create', 'docs.append_block'])
    expect(result).toMatchObject({ ref: { kind: 'call', id: 'call-1' }, result: { summary: 'Итоги', decisionRefs: [{ kind: 'decision', id: 'decision-1' }] } })
  })

  it('X-16 reminders: the record carries subjectRef and names the reminder_due kind', async () => {
    const { ports, run } = harness()
    const created: unknown[] = []
    const spy = { ...ports, reminders: { create: async (record: unknown) => { created.push(record); return { id: 'r-9' } }, cancel: async () => true } }
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    bindXfnReferenceHandlers(registry, { ports: spy, enabled: true })
    const result = await registry.handler('reminders.create')!({
      envelope: { commandId: 'cmd-9', idempotencyKey: 'cmd-9', type: 'reminders.create', payload: {}, issuedAt: 'T' },
      payload: { subjectRef: ref('goal', 'g1'), at: '2026-10-09T09:00:00.000Z', deliver: ['inbox'] },
      workspaceId: 'w1', actor: ACTOR, authority: 'local', conflict: () => { throw new Error('x') },
    } as CommandHandlerContext<unknown>)
    expect(created[0]).toMatchObject({
      id: 'cmd-9', principalId: 'me', subjectRef: ref('goal', 'g1'), at: '2026-10-09T09:00:00.000Z',
      channels: ['inbox'], schemaVersion: 2, workspaceId: 'w1',
    })
    expect(result).toMatchObject({ result: { id: 'r-9', notificationKind: 'reminder_due' } })
    expect(await run('reminders.cancel', { id: 'r-9' })).toMatchObject({ result: { cancelled: true } })
  })

  it('X-17 draft: reads activity and writes nothing', async () => {
    const { run, calls } = harness()
    const result = await run('checkins.draft_from_activity', { subjectRef: ref('goal', 'g1'), since: '2026-10-01T00:00:00.000Z' })
    expect(calls).toEqual([])
    expect(result).toMatchObject({ ref: ref('goal', 'g1'), result: { draft: true, writes: 0, activity: [{ kind: 'checkin', id: 'c1' }] } })
  })

  it('X-18 linked work: default relation by pair, aligned-to and member-of payloads', async () => {
    expect(goalWorkRelation(ref('project', 'p1'), ref('task', 't1'))).toEqual({ relation: 'member-of' })
    expect(goalWorkRelation(ref('goal', 'g1'), ref('project', 'p1'))).toEqual({ relation: 'aligned-to' })
    expect(goalWorkRelation(ref('channel', 'c1'), ref('task', 't1'))).toEqual({ relation: null })

    const { run, calls } = harness()
    await run('goals.link_work', { goalRef: ref('project', 'p1'), workRef: ref('task', 't1') })
    await run('goals.link_work', { goalRef: ref('goal', 'g1'), workRef: ref('kpi', 'k1'), role: 'okr-of' })
    await run('goals.unlink_work', { goalRef: ref('project', 'p1'), workRef: ref('task', 't1'), relation: 'member-of' })
    expect(calls).toEqual([
      { command: 'links.add', payload: { from: ref('task', 't1'), to: ref('project', 'p1'), relation: 'member-of' } },
      { command: 'links.add', payload: { from: ref('kpi', 'k1'), to: ref('goal', 'g1'), relation: 'aligned-to', role: 'okr-of' } },
      { command: 'links.remove', payload: { from: ref('task', 't1'), to: ref('project', 'p1'), relation: 'member-of' } },
    ])
    const refused = await run('goals.link_work', { goalRef: ref('channel', 'c1'), workRef: ref('task', 't1') })
    expect(refused).toMatchObject({ result: { linked: false, reason: 'invalid_kind' } })
  })

  it('X-22 create-from-email: derived-from is written in the same call', async () => {
    const { run, calls } = harness()
    const mail = ref('mail-thread', 'm1')
    await run('tasks.create_from_email', { messageRef: mail, title: 'Из письма', assignee: ref('person', 'p2') })
    await run('docs.create_from_email', { messageRef: mail, wholeThread: true })
    await run('im.share_entity', { ref: mail, chatRef: ref('channel', 'c1'), importAttachments: true })
    await run('calendar.create_event_from_email', { messageRef: mail, attendees: 'participants', call: true })
    const commands = calls.map((call) => call.command)
    expect(commands).toEqual([
      'tasks.create', 'links.add',
      'docs.create_document', 'links.add',
      'im.send_message',
      'calendar.create_event', 'links.add',
    ])
    expect(calls[1]).toEqual({ command: 'links.add', payload: { from: { kind: 'task', id: 'task-1' }, to: mail, relation: 'derived-from', role: 'origin' } })
  })

  it('X-23 form actions: the plan names the idempotency template of each action', async () => {
    const { run } = harness()
    const result = await run('forms.configure_on_submit', {
      formRef: ref('form', 'f1'),
      actions: [{ kind: 'tasks.create', config: {} }, { kind: 'tables.insert_row', config: {} }],
    })
    expect(result).toMatchObject({ ref: ref('form', 'f1'), result: { formRef: 'form:f1' } })
    expect((result.result as { actions: unknown[] }).actions).toEqual([
      { kind: 'tasks.create', index: 0, idempotencyKeyTemplate: '${formResponseId}:0' },
      { kind: 'tables.insert_row', index: 1, idempotencyKeyTemplate: '${formResponseId}:1' },
    ])
    expect(formActionIdempotencyKey('resp-1', 2)).toBe('resp-1:2')
    expect(() => formActionIdempotencyKey('', 2)).toThrow()
    expect(() => formActionIdempotencyKey('resp-1', -1)).toThrow()
    expect(formResponsePlan(ref('form', 'f1'), [])).toEqual({ formRef: 'form:f1', actions: [] })
  })

  it('X-24 start meeting: call + derived-from the origin', async () => {
    const { run, calls } = harness()
    const result = await run('vc.start_meeting', { origin: ref('channel', 'c1'), invite: ['p1', 'p2'] })
    expect(calls).toEqual([
      { command: 'links.add', payload: { from: ref('call', 'call-1'), to: ref('channel', 'c1'), relation: 'derived-from', role: 'origin' } },
    ])
    expect(result).toMatchObject({ ref: ref('call', 'call-1'), result: { invited: 2 } })
  })

  it('refuses every capability while xfn.capabilities.v1 is off', async () => {
    const { run } = harness({ enabled: false })
    for (const command of XFN_COMMAND_NAMES) {
      await expect(run(command, {})).rejects.toThrow(XfnFlagOffError)
    }
  })
})

describe('W1-15 capability discovery and risk classes', () => {
  it('asks the registry for {available, reason} and hides when the flag is off', () => {
    const flags = new Set<string>()
    const registry = new CommandRegistry({ isFlagEnabled: (flag) => flags.has(flag) })
    registerCommandCatalogue(registry)
    const before = xfnAvailability(registry, 'X-13')
    expect(before).toEqual({ available: false, reason: 'flag_off' })

    flags.add('xfn.capabilities.v1')
    expect(xfnAvailability(registry, 'X-13')).toEqual({ available: false, reason: 'not_bound' })
    const harnessed = harness()
    expect(xfnAvailability(harnessed.registry, 'X-13')).toEqual({ available: true })
    // X-20 / X-21 / X-25 have no command to discover through: the flag decides.
    expect(xfnAvailability(registry, 'X-20')).toEqual({ available: false, reason: 'unavailable' })
    expect(xfnAvailability(registry, 'X-20', { isFlagEnabled: () => false })).toEqual({ available: false, reason: 'flag_off' })
    expect(xfnAvailability(registry, 'X-20', { isFlagEnabled: () => true })).toEqual({ available: true })
    expect(xfnAvailability(registry, 'X-25', { isFlagEnabled: () => false })).toEqual({ available: false, reason: 'flag_off' })
    expect(commandAvailability(harnessed.registry, 'entities.drop')).toEqual({ available: true })
    expect(commandAvailability(harnessed.registry, 'nope.nope')).toEqual({ available: false, reason: 'unknown_command' })
  })

  it('binds the XFN schemas and risk classes without defining a name', () => {
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    const schemas = Object.fromEntries(XFN_COMMAND_NAMES.map((name) => [name, { safeParse: (value: unknown) => ({ success: true as const, data: value as never }) }]))
    const report = bindXfnContracts(registry, { schemas })
    expect(report.missingCommands).toEqual([])
    expect(report.missingSchemas).toEqual([])
    expect(report.bound).toEqual([...XFN_COMMAND_NAMES])
    expect(report.riskBound).toEqual([...XFN_COMMAND_NAMES])

    const withGap = bindXfnContracts(registry, { schemas: { ...schemas, 'entities.pin': undefined as never } })
    expect(withGap.missingSchemas).toEqual(['entities.pin'])
    expect(unboundXfnCommands(registry)).toEqual([])
  })

  it('applies the §20 risk classes, including the batch maximum', () => {
    const ctx: XfnRiskContext = { workspaceId: 'w1', actor: { principalId: 'me', kind: 'agent' } }
    const risk = (command: string, payload: unknown, over: Partial<XfnRiskContext> = {}) =>
      XFN_RISK_CLASSES[command]!(payload as never, { ...ctx, ...over })

    expect(risk('calendar.create_time_block', {})).toBe('routine')
    expect(risk('reminders.create', {})).toBe('routine')
    expect(risk('entities.pin', {})).toBe('routine')
    expect(risk('meetings.publish_outcomes', {})).toBe('consequential')
    expect(risk('forms.configure_on_submit', {})).toBe('consequential')
    expect(risk('vc.start_meeting', { invite: [] })).toBe('routine')
    expect(risk('vc.start_meeting', { invite: ['p1'] })).toBe('consequential')
    expect(risk('tasks.create_from_email', {})).toBe('routine')
    expect(risk('tasks.create_from_email', { assignee: { kind: 'person', id: 'me' } })).toBe('routine')
    expect(risk('tasks.create_from_email', { assignee: { kind: 'person', id: 'someone-else' } })).toBe('consequential')
    expect(risk('calendar.create_event_from_email', { attendees: 'sender' })).toBe('consequential')
    expect(risk('calendar.create_event_from_email', { attendees: [] })).toBe('routine')
    expect(risk('goals.link_work', { workRef: ref('task', 't1') })).toBe('consequential')
    expect(risk('goals.link_work', { workRef: ref('task', 't1') }, { owns: () => true })).toBe('routine')

    // X-19 takes the strictest item; an unknown type fails safe.
    expect(risk('commands.batch', { commands: [{ type: 'tasks.create', payload: {} }] })).toBe('consequential')
    setXfnRiskResolver(() => 'routine')
    expect(risk('commands.batch', { commands: [{ type: 'tasks.create', payload: {} }, { type: 'forms.configure_on_submit', payload: {} }] }))
      .toBe('routine')
    setXfnRiskResolver(undefined)
    expect(maxRiskClass('routine', 'privileged')).toBe('privileged')
    expect(maxRiskClass(undefined, 'routine')).toBe('routine')
    expect(maxRiskClass(undefined, undefined)).toBeUndefined()

    // A registry-backed resolver is the wiring the host uses.
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    registry.bindSchema('tasks.create', { safeParse: (value: unknown) => ({ success: true as const, data: value as never }) }, { riskClass: () => 'routine' })
    setXfnRiskResolver(registryRiskResolver(registry))
    expect(risk('commands.batch', { commands: [{ type: 'tasks.create', payload: {} }] })).toBe('routine')
    setXfnRiskResolver(undefined)
  })

  it('keeps the form-action risk fail-safe and the local spin filter owner-scoped', () => {
    expect(XFN_RISK_CLASSES['tables.insert_row']?.({} as never, { workspaceId: 'w1', actor: { principalId: 'me', kind: 'agent' } })).toBe('routine')
    const pin = (createdBy: string, id: string, position: number): PinLink => ({
      relation: PIN_RELATION, role: 'pin', createdBy, ref: { kind: 'task', id }, anchor: { position },
    })
    expect(visiblePins([pin('me', 't1', 1), pin('other', 't2', 0)], 'me')).toEqual([pin('me', 't1', 1)])
    expect(visiblePins([pin('me', 't1', 5), pin('me', 't2', 0)], 'me')).toEqual([pin('me', 't2', 0), pin('me', 't1', 5)])
  })
})