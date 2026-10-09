/**
 * W1-12 (#1509) — The rule engine against the real command handlers on the
 * local authority (acceptance: "all five rules run end to end on reference
 * handlers in the harness, with zero duplicates", "local-mode R1 / R3 / R5",
 * "R2 / R3 share one agent", "3× replay with a failure injected at each step").
 *
 * Local mode is the whole local authority: the SQLite command store
 * (`.rox/commands.sqlite`), the W1-06 reference handlers writing
 * `{workspaceRoot}/work/`, the PersonalTask v3 store (tasks and task lists),
 * the entity-link store and the rules' own store — all under one `mkdtemp`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTOMATION_RULES_FLAG,
  systemListId,
  welcomeMessageId,
  type RuleExecutionRecord,
  type RuleRunOutcome,
} from '@rox/core/automation'
import type { DomainEvent } from '@rox/core/events'
import { dailyLinkBlockId, dailyNoteId } from '@rox/core/docs/daily'
import { CommandExecutor } from '../../commands/executor'
import { InProcessEventBus } from '../../commands/event-bus'
import { SqliteCommandStore } from '../../commands/local-store'
import { createWiredCommandRegistry } from '../../commands/registry'
import { CommandStoreUnavailable } from '../../commands/store'
import { EntityLinkStore } from '../../entities/link-store'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { configureReferenceRuntime, resetReferenceRuntime } from '../../work/reference'
import { collectionSpec } from '../../work/reference/collections'
import { LocalWorkStore } from '../../work/local-work-store'
import { InMemoryRulesStore } from '../store'
import { createLocalRuleHost } from '../host'
import { RuleEngine, type RuleDispatch } from '../engine'
import { createLocalRulesConsumer, type LocalRulesConsumer } from '../consumer'
import { RuleSettingsService } from '../settings'

const WS = 'ws-1'
const ORGANISER = 'principal-mark'
const MEMBER = 'principal-anna'
const GENERAL_CHAT = 'chat-general'
const NOW = '2026-10-08T09:00:00.000Z'
const ALL_FLAGS = [
  AUTOMATION_RULES_FLAG,
  // Owner-module flags: availability of every command the rules dispatch
  // (TECH-SPEC §8). A step whose owner module is off is UNAVAILABLE by design.
  'entities.links.v1', 'docs.shared.v1', 'docs.drive.v1', 'tasks.lark.v1', 'tasks.shared.v1',
  'workbench.mode.messenger.v1', 'workbench.mode.calendar.v1', 'workbench.mode.contacts.v1',
  'identity.placeholders.v1', 'onboarding.welcome.v1', 'agents.autonomy.v1', 'drive.personal.v1',
]

let root: string
let clock: Date
let store: SqliteCommandStore
let tasks: PersonalTaskPersistStore
let links: EntityLinkStore
let bus: InProcessEventBus

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'w1-12-rules-'))
  clock = new Date(NOW)
  store = new SqliteCommandStore({ workspaceRoot: root })
  tasks = new PersonalTaskPersistStore(join(root, 'config'))
  bus = new InProcessEventBus()
})
afterEach(() => {
  resetReferenceRuntime()
  store.close()
  rmSync(root, { recursive: true, force: true })
})

interface HarnessOptions {
  /** Command authority the steps dispatch through: the local bus or the workspace service. */
  authority?: 'local' | 'workspace'
  flags?: readonly string[]
  /** Command types whose dispatch throws once (failure injection). */
  failOnce?: readonly string[]
  /** Fail every dispatch of these types (attempt-budget tests). */
  failAlways?: readonly string[]
  /** Throw `CommandStoreUnavailable` once for these types (transient store outage). */
  failTransientOnce?: readonly string[]
  scheduler?: (delayMs: number, task: () => void) => () => void
  onExecution?: (outcome: RuleRunOutcome) => void
}

interface Harness {
  engine: RuleEngine
  consumer: LocalRulesConsumer
  executor: CommandExecutor
  rules: InMemoryRulesStore
  settings: RuleSettingsService
  work: LocalWorkStore
  handle(event: DomainEvent): Promise<RuleRunOutcome[]>
  run(type: string, payload: Record<string, unknown>, actor?: string): Promise<{ status: string; ref?: unknown }>
  list(collection: string): Array<Record<string, unknown>>
  /** All executions of the workspace (store read). */
  executions(): Promise<RuleExecutionRecord[]>
  failCount(type: string): number
  /** Stop injecting failures for a type (a manual retry after the outage). */
  stopFailing(type: string): void
  errors: unknown[]
}

function createHarness(options: HarnessOptions = {}): Harness {
  const flags = new Set<string>(options.flags ?? ALL_FLAGS)
  const enabled = (flag: string): boolean => flags.has(flag)
  links = new EntityLinkStore({ workspaceRoot: root })
  configureReferenceRuntime({ now: () => clock, workspaceRoot: () => root, personalTaskStore: () => tasks, linkIndex: () => links, isFlagEnabled: enabled })

  const registry = createWiredCommandRegistry({ isFlagEnabled: enabled })
  const executor = new CommandExecutor({
    registry,
    store,
    authority: options.authority ?? 'local',
    isEnabled: () => true,
    publish: events => { bus.publish(events) },
  })
  const rules = new InMemoryRulesStore()
  const work = new LocalWorkStore({ workspaceRoot: root })
  const errors: unknown[] = []
  const failures = new Map<string, number>()
  const failOnce = new Set(options.failOnce ?? [])
  const failAlways = new Set(options.failAlways ?? [])
  const failTransient = new Set(options.failTransientOnce ?? [])
  const dispatch: RuleDispatch = async input => {
    const type = input.envelope.type
    if (failAlways.has(type)) {
      failures.set(type, (failures.get(type) ?? 0) + 1)
      throw new Error(`injected failure: ${type}`)
    }
    if ((failOnce.has(type) || failTransient.has(type)) && (failures.get(type) ?? 0) === 0) {
      failures.set(type, 1)
      if (failTransient.has(type)) throw new CommandStoreUnavailable(new Error(`injected outage: ${type}`))
      throw new Error(`injected failure: ${type}`)
    }
    return executor.execute(input)
  }

  const engine = new RuleEngine(createLocalRuleHost({
    workspaceId: WS,
    workspaceRoot: root,
    executions: rules,
    settingsStore: rules,
    dispatch,
    authorityHint: options.authority ?? 'local',
    isFlagEnabled: enabled,
    now: () => clock,
    onExecution: outcome => options.onExecution?.(outcome),
    onError: error => { errors.push(error) },
    ...(options.scheduler ? { scheduler: { schedule: options.scheduler } } : {}),
  }))
  const consumer = createLocalRulesConsumer({
    workspaceId: WS,
    workspaceRoot: root,
    bus,
    dispatch,
    executions: rules,
    settingsStore: rules,
    isFlagEnabled: enabled,
    now: () => clock,
  })
  let counter = 0
  return {
    engine,
    consumer,
    executor,
    rules,
    settings: new RuleSettingsService({ store: rules, workspaceId: WS, now: () => clock, isAdmin: async () => true }),
    work,
    handle: event => engine.handleEvent(event),
    async run(type, payload, actor = ORGANISER) {
      counter += 1
      const receipt = await executor.execute({
        workspaceId: WS,
        actor: { principalId: actor, kind: 'user' },
        envelope: { commandId: `cmd-${counter}`, type, payload, issuedAt: NOW },
      })
      if (receipt.status !== 'applied' && receipt.status !== 'duplicate') {
        throw new Error(`${type} failed: ${JSON.stringify(receipt.error ?? receipt.status)}`)
      }
      return { status: receipt.status, ...(receipt.ref ? { ref: receipt.ref } : {}) }
    },
    list(collection) {
      // Same mapping as the local backend: collections write into their `localDir`.
      return work.list<Record<string, unknown>>(collectionSpec(collection).localDir ?? collection)
        .map(record => ({ id: record.id, revision: record.revision, ...record.record }))
    },
    executions() {
      return rules.list(WS)
    },
    failCount(type) {
      return failures.get(type) ?? 0
    },
    stopFailing(type) {
      failAlways.delete(type)
      failOnce.delete(type)
      failTransient.delete(type)
    },
    errors,
  }
}

function calendarEvent(overrides: Record<string, unknown> = {}, eventId = 'evt-1'): DomainEvent {
  return {
    eventId,
    workspaceId: WS,
    type: 'calendar.event_created',
    actorId: ORGANISER,
    subject: { kind: 'calendar-event', id: 'event-1' },
    aggregateRevision: 1,
    payload: { event: { ...eventSnapshot(), ...overrides } },
    createdAt: NOW,
  }
}

function eventSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: { kind: 'calendar-event', id: 'event-1' },
    calendarId: 'calendar-1',
    title: 'Планёрка',
    startAt: '2026-10-09T07:00:00.000Z',
    endAt: '2026-10-09T07:30:00.000Z',
    allDay: false,
    organizerId: ORGANISER,
    attendeeIds: [ORGANISER, MEMBER],
    ...overrides,
  }
}

function accountCreated(principalId = ORGANISER, eventId = 'evt-account'): DomainEvent {
  return { eventId, workspaceId: WS, type: 'identity.account_created', subject: { kind: 'person', id: principalId }, aggregateRevision: 1, payload: { principalId, source: 'oidc', verified: true }, createdAt: NOW }
}

function memberAdded(principalId = MEMBER, eventId = 'evt-member'): DomainEvent {
  return { eventId, workspaceId: WS, type: 'people.member_added', subject: { kind: 'person', id: principalId }, aggregateRevision: 1, payload: { principalId, status: 'active', generalChatId: GENERAL_CHAT }, createdAt: NOW }
}

function invitationsSent(): DomainEvent {
  return {
    eventId: 'evt-invite', workspaceId: WS, type: 'people.invitations_sent', aggregateRevision: 1,
    subject: { kind: 'person', id: ORGANISER },
    payload: { invitedBy: ORGANISER, invitations: [{ email: 'anna@example.com', role: 'member' }] }, createdAt: NOW,
  }
}

const executionOf = async (harness: Harness, key: string) => (await harness.executions()).find(record => record.idempotencyKey === key)

/**
 * Fixture for the ONB / `workspaces.create` state (W1-11 owns the real one):
 * a General chat with active member rows (D-v2-2), written straight into the
 * local work store because `im.create_chat` is a workspace-authority command.
 */
function seedGeneralChat(harness: Harness, members: readonly string[]): void {
  harness.work.put(collectionSpec('channel').localDir ?? 'channel', GENERAL_CHAT, { kind: 'group', visibility: 'public', name: 'Общий', systemRole: 'general', postingPolicy: 'all', invitePolicy: 'members', createdBy: members[0] ?? ORGANISER }, null)
  for (const member of members) {
    harness.work.put(collectionSpec('channel-member').localDir ?? 'channel-member', `${GENERAL_CHAT}:${member}`, { chatId: GENERAL_CHAT, principalId: member, state: 'active', role: member === (members[0] ?? ORGANISER) ? 'owner' : 'member', joinedAt: NOW }, null)
  }
}

describe('R1 end to end on the reference handlers (local)', () => {
  test('creates the backlog list, the notes, the prep task and the links — once per event', async () => {
    const harness = createHarness()
    const first = await harness.handle(calendarEvent())
    expect(first).toHaveLength(1)
    expect(first[0]!).toMatchObject({ ruleId: 'R1', key: 'R1:event-1:single:principal-mark', status: 'succeeded', duplicate: false })
    expect(first[0]!.steps.map(step => step.status)).toEqual(Array.from({ length: 8 }, () => 'succeeded'))

    // D-v2-4: the prep task goes to the per-user system list «Бэклог» (a v2 project locally).
    const list = tasks.getTaskList(systemListId(WS, ORGANISER, 'backlog'))!
    expect(list).toBeTruthy()
    expect(list.data.name).toBe('Бэклог')
    expect(list.data.systemKey).toBe('backlog')
    expect(list.data.ownerId).toBe(ORGANISER)

    const notes = harness.list('note')
    expect(notes).toHaveLength(2)
    const daily = notes.find(note => note.id === dailyNoteId(WS, ORGANISER, '2026-10-09'))!
    const minutes = notes.find(note => note.subtype === 'minutes')!
    expect(daily).toMatchObject({ subtype: 'daily', dailyDate: '2026-10-09', ownerId: ORGANISER })
    expect(minutes).toMatchObject({ title: 'Планёрка', ownerId: ORGANISER })

    // The daily link is one block, updated in place (TECH-SPEC §14.3).
    const blocks = harness.list('doc-block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      id: dailyLinkBlockId('R1:event-1:single:principal-mark'),
      kind: 'link',
      docId: daily.id,
      link: { kind: 'note', id: minutes.id },
      time: '2026-10-09T07:00:00.000Z',
    })

    const [task] = tasks.list()
    expect(task!.task.title).toBe('Подготовиться: Планёрка')
    expect(task!.task.dueAt).toBe(Date.parse('2026-10-09T07:00:00.000Z'))
    const item = tasks.getWorkItem(task!.task.id)!.item
    expect(item.listId).toBe(systemListId(WS, ORGANISER, 'backlog'))
    expect(item.origin).toEqual({ kind: 'calendar-event', id: 'event-1' })
    expect(item.customFields).toEqual({ draft: true })

    // Three links: minutes → event (attached-to/minutes), task → event (derived-from), minutes → daily (parent).
    const minutesLinks = links.outgoing({ kind: 'note', id: String(minutes.id) })
    // `docs.create_meeting_notes` already links minutes → event (`derived-from`);
    // R1 adds `attached-to` (role minutes) and the daily `parent` link.
    expect(minutesLinks.map(link => `${link.relation}:${link.to.kind}`).sort())
      .toEqual(['attached-to:calendar-event', 'derived-from:calendar-event', 'parent:note'])
    expect(links.outgoing({ kind: 'note', id: String(daily.id) }).map(link => `${link.relation}:${link.to.kind}`)).toEqual(['mentions:note'])
    expect(minutesLinks.find(link => link.relation === 'attached-to')!.role).toBe('minutes')
    expect(links.outgoing({ kind: 'task', id: task!.task.id })[0]).toMatchObject({ relation: 'derived-from', to: { kind: 'calendar-event', id: 'event-1' } })
  })

  test('3× replay of the same event: one execution, zero duplicates', async () => {
    const harness = createHarness()
    const event = calendarEvent()
    await harness.handle(event)
    expect((await harness.handle(event))[0]).toMatchObject({ duplicate: true, status: 'succeeded' })
    expect((await harness.handle(event))[0]).toMatchObject({ duplicate: true, status: 'succeeded' })

    expect((await harness.executions())).toHaveLength(1)
    expect(tasks.getTaskList(systemListId(WS, ORGANISER, 'backlog'))).toBeTruthy()
    expect(harness.list('note')).toHaveLength(2)
    expect(harness.list('doc-block')).toHaveLength(1)
    expect(tasks.list()).toHaveLength(1)
    expect(harness.list('entity-link')).toHaveLength(5)
  })

  test('a recurring occurrence gets its own key and its own artifacts', async () => {
    const harness = createHarness()
    await harness.handle(calendarEvent())
    const occurrence: DomainEvent = {
      eventId: 'evt-occurrence',
      workspaceId: WS,
      type: 'calendar.occurrence_upcoming',
      subject: { kind: 'calendar-event', id: 'event-1' },
      aggregateRevision: 1,
      payload: {
        event: eventSnapshot(),
        occurrenceStart: '2026-10-16T07:00:00.000Z',
        occurrenceEnd: '2026-10-16T07:30:00.000Z',
      },
      createdAt: NOW,
    }
    const [outcome] = await harness.handle(occurrence)
    expect(outcome).toMatchObject({ key: 'R1:event-1:2026-10-16T07:00:00.000Z:principal-mark', status: 'succeeded' })
    expect((await harness.executions())).toHaveLength(2)
    expect(harness.list('note')).toHaveLength(4)
    expect(harness.list('doc-block')).toHaveLength(2)
    expect(tasks.list()).toHaveLength(2)
  })

  test('external events use the provider uid and never re-fire on a re-sync', async () => {
    const harness = createHarness()
    const external: DomainEvent = {
      eventId: 'evt-external',
      workspaceId: WS,
      type: 'calendar.external_event_seen',
      subject: { kind: 'calendar-event', id: 'event-1' },
      aggregateRevision: 1,
      payload: { event: eventSnapshot(), provider: 'google', providerUid: 'uid-9' },
      createdAt: NOW,
    }
    const [first] = await harness.handle(external)
    expect(first).toMatchObject({ key: 'R1:uid-9:single:principal-mark', status: 'succeeded' })
    const [again] = await harness.handle({ ...external, eventId: 'evt-external-2' })
    expect(again).toMatchObject({ duplicate: true, status: 'succeeded' })
    expect((await harness.executions())).toHaveLength(1)
    expect(tasks.list()).toHaveLength(1)
  })
})

describe('failure injection at every step (3× replay each)', () => {
  const stepTypes = [
    'task_lists.ensure_system_list',
    'docs.ensure_daily_note',
    'docs.create_meeting_notes',
    'docs.append_daily_link',
    'tasks.create',
    'links.add',
  ]
  for (const type of stepTypes) {
    test(`${type}: resumes from the failed step, zero duplicates`, async () => {
      const harness = createHarness({ failOnce: [type] })
      const event = calendarEvent()
      const first = await harness.handle(event)
      expect(first[0]!.status).toBe('running')
      const failed = first[0]!.steps.filter(step => step.status === 'failed').map(step => step.action)
      expect(failed.length).toBeGreaterThan(0)
      expect(harness.failCount(type)).toBe(1)

      const second = await harness.handle(event)
      expect(second[0]!.status).toBe('succeeded')
      const third = await harness.handle(event)
      expect(third[0]).toMatchObject({ duplicate: true, status: 'succeeded' })

      expect((await harness.executions())).toHaveLength(1)
      const record = (await harness.executions())[0]!
      expect(record.attempts).toBe(2)
      expect(record.steps.every(step => step.status === 'succeeded')).toBe(true)
      // The steps before the failure ran once; the resumed one is on its second attempt.
      const resumed = record.steps.find(step => (step.attempts ?? 0) > 1)
      expect(resumed).toBeTruthy()
      expect(resumed!.status).toBe('succeeded')

      // Zero duplicates of every artifact, whatever the injected step was.
      expect(harness.list('note')).toHaveLength(2)
      expect(harness.list('doc-block')).toHaveLength(1)
      expect(tasks.list()).toHaveLength(1)
      expect(tasks.getTaskList(systemListId(WS, ORGANISER, 'backlog'))).toBeTruthy()
    })
  }

  test('a transient store outage stays retryable and the next replay finishes it', async () => {
    const harness = createHarness({ failTransientOnce: ['docs.create_meeting_notes'] })
    const event = calendarEvent()
    const first = await harness.handle(event)
    expect(first).toEqual([])
    expect(harness.errors).toHaveLength(1)
    const record = (await executionOf(harness, 'R1:event-1:single:principal-mark'))!
    expect(record.status).toBe('running')
    expect(record.steps.some(step => step.status === 'pending')).toBe(true)

    const second = await harness.handle(event)
    expect(second[0]).toMatchObject({ status: 'succeeded' })
    expect(harness.list('note')).toHaveLength(2)
    expect(tasks.list()).toHaveLength(1)
  })

  test('an optional step that keeps failing ends as partially_succeeded', async () => {
    const harness = createHarness({ authority: 'workspace', failAlways: ['onboarding.seed_starter_content'] })
    const outcomes = await harness.handle(accountCreated())
    const r3 = outcomes.find(outcome => outcome.ruleId === 'R3')!
    expect(r3.status).toBe('partially_succeeded')
    const welcome = harness.list('channel-message')
    expect(welcome).toHaveLength(1)
  })
})

describe('attempt budget and manual retry', () => {
  test('4 attempts with the 1/5/30/120-minute backoff, then failed; a forced retry completes it', async () => {
    const scheduled: Array<{ at: number; task: () => void }> = []
    const harness = createHarness({
      failAlways: ['docs.create_meeting_notes'],
      scheduler: (delayMs, task) => {
        scheduled.push({ at: clock.getTime() + delayMs, task })
        return () => undefined
      },
    })
    const event = calendarEvent()
    await harness.handle(event)
    const key = 'R1:event-1:single:principal-mark'
    expect(await executionOf(harness, key)).toMatchObject({ status: 'running', attempts: 1 })
    expect(scheduled.map(entry => entry.at - clock.getTime())).toEqual([60_000])

    // The backoff gate: a resume before the delay elapses does nothing.
    const early = await harness.engine.resumePending()
    expect(early).toEqual([])
    expect((await executionOf(harness, key))!.attempts).toBe(1)

    for (const expected of [2, 3, 4] as const) {
      clock = new Date(scheduled.shift()!.at)
      await harness.engine.resumePending()
      const record = (await executionOf(harness, key))!
      expect(record.attempts).toBe(expected)
      expect(record.status).toBe(expected === 4 ? 'failed' : 'running')
      expect(scheduled).toHaveLength(expected === 4 ? 0 : 1)
    }
    // Nothing duplicated along the way: the daily note exists once, the failing
    // step (the minutes note) created nothing, the prep task never ran.
    expect(harness.list('note')).toHaveLength(1)
    expect(tasks.list()).toHaveLength(0)

    // The retry route (`POST …/retry`) forces the attempt and finishes the execution.
    harness.stopFailing('docs.create_meeting_notes')
    const failed = (await executionOf(harness, key))!
    const retry = await harness.engine.resumeExecution(failed, { force: true })
    expect(retry.status).toBe('succeeded')
    expect(harness.list('note')).toHaveLength(2)
    expect((await harness.executions())).toHaveLength(1)
  })
})

describe('negative paths: R1 opt-out and skip reasons', () => {
  test('R1 disabled per user: no execution, no artifacts', async () => {
    const harness = createHarness()
    await harness.settings.update('R1', { enabled: false }, { principalId: ORGANISER, isAdmin: false })
    expect(await harness.handle(calendarEvent())).toEqual([])
    expect((await harness.executions())).toHaveLength(0)
    expect(harness.list('note')).toHaveLength(0)
    expect(tasks.list()).toHaveLength(0)
  })

  test('TECH-SPEC §14.3: an all-day event is recorded as skipped and never retried', async () => {
    const harness = createHarness()
    const [outcome] = await harness.handle(calendarEvent({ allDay: true }))
    expect(outcome).toMatchObject({ status: 'skipped', skippedReason: 'all_day' })
    expect(harness.list('note')).toHaveLength(0)
    expect(tasks.list()).toHaveLength(0)
    await harness.handle(calendarEvent({ allDay: true }))
    expect((await harness.executions())).toHaveLength(1)
    expect((await executionOf(harness, 'R1:event-1:single:principal-mark'))!.status).toBe('skipped')
  })

  test('a declined organiser, a free event and a #no-notes tag are skipped', async () => {
    const harness = createHarness()
    const [declined] = await harness.handle(calendarEvent({ declinedByIds: [ORGANISER] }))
    const [free] = await harness.handle(calendarEvent({ transparency: 'free' }, 'evt-2'))
    const [tagged] = await harness.handle(calendarEvent({ keywords: ['#no-notes'] }, 'evt-3'))
    expect([declined!.skippedReason, free!.skippedReason, tagged!.skippedReason]).toEqual(['declined', 'free', 'no_notes_keyword'])
    expect(harness.list('note')).toHaveLength(0)
  })

  test('D-v2-3: the notes and the task belong to the organiser only', async () => {
    const harness = createHarness()
    await harness.handle(calendarEvent())
    expect(harness.list('note').every(note => note.ownerId === ORGANISER)).toBe(true)
    expect(tasks.getWorkItem(tasks.list()[0]!.task.id)!.item.ownerPrincipalId).toBe(ORGANISER)
    expect((await harness.executions())).toHaveLength(1)
  })
})

describe('R2 + R3 ordering: one personal agent, one welcome', () => {
  test('R2 then R3 provision the same agent (shared command id) and post one welcome', async () => {
    const harness = createHarness({ authority: 'workspace' })
    seedGeneralChat(harness, [MEMBER])
    const [r2] = await harness.handle(memberAdded())
    expect(r2).toMatchObject({ ruleId: 'R2', key: `R2:${WS}:${MEMBER}`, status: 'succeeded' })
    const [r3] = await harness.handle(accountCreated(MEMBER))
    expect(r3).toMatchObject({ ruleId: 'R3', key: `R3:${MEMBER}`, status: 'succeeded' })

    // One agent, provisioned by R2; R3's step is an idempotent duplicate.
    const agents = harness.list('agent')
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ ownerId: MEMBER })
    expect(r3!.steps.find(step => step.action === 'provision-agent')!.receipt_status).toBe('duplicate')

    // One welcome message in the agent DM, sent by the agent principal (plus
    // the R2 join card in General).
    const messages = harness.list('channel-message')
    const welcome = messages.filter(message => message.id === welcomeMessageId(MEMBER))
    expect(welcome).toHaveLength(1)
    expect(welcome[0]).toMatchObject({ senderId: agents[0]!.id })
    expect(String((welcome[0]!.content as { doc: string }).doc)).toContain('Привет')
    expect(messages).toHaveLength(2)

    // The DM holds both members; the R2 join card went to the General chat.
    const channels = harness.list('channel').map(channel => channel.id).sort()
    expect(channels).toEqual([GENERAL_CHAT, welcome[0]!.chatId].sort())
  })

  test('R3 first, then R2: still exactly one agent and one welcome', async () => {
    const harness = createHarness({ authority: 'workspace' })
    seedGeneralChat(harness, [MEMBER])
    const [r3] = await harness.handle(accountCreated(MEMBER))
    expect(r3).toMatchObject({ status: 'succeeded' })
    const [r2] = await harness.handle(memberAdded())
    expect(r2!.steps.find(step => step.action === 'provision-agent')!.receipt_status).toBe('duplicate')
    expect(harness.list('agent')).toHaveLength(1)
    expect(harness.list('channel-message').filter(message => message.id === welcomeMessageId(MEMBER))).toHaveLength(1)
  })
})

describe('R4 and R5', () => {
  test('R4 invites: a placeholder, a member row, the team chat and one email', async () => {
    const harness = createHarness({ authority: 'workspace' })
    seedGeneralChat(harness, [ORGANISER, MEMBER])
    const [outcome] = await harness.handle(invitationsSent())
    expect(outcome).toMatchObject({ ruleId: 'R4', key: `R4:${WS}:anna@example.com`, status: 'succeeded' })
    const placeholders = harness.list('placeholder')
    expect(placeholders).toHaveLength(1)
    expect(placeholders[0]).toMatchObject({ email: 'anna@example.com', state: 'placeholder' })
    const inviteEmails = harness.list('invitation')
    expect(inviteEmails).toHaveLength(1)
    expect(inviteEmails[0]).toMatchObject({ email: 'anna@example.com', state: 'queued' })

    // Replay: still exactly one of each.
    await harness.handle(invitationsSent())
    expect(harness.list('placeholder')).toHaveLength(1)
    expect(harness.list('invitation')).toHaveLength(1)
  })

  test('R5 provisions the personal drive with the 1 TiB default and the virtual folders', async () => {
    const harness = createHarness({ authority: 'workspace' })
    const outcomes = await harness.handle(accountCreated())
    const outcome = outcomes.find(entry => entry.ruleId === 'R5')!
    expect(outcome).toMatchObject({ ruleId: 'R5', key: `R5:${ORGANISER}`, status: 'succeeded' })
    const drives = harness.list('drive-quota')
    expect(drives).toHaveLength(1)
    expect(drives[0]).toMatchObject({ ownerPrincipalId: ORGANISER, state: 'active', quotaBytes: 1024 ** 4 })
    expect(harness.list('folder').map(folder => folder.name).sort()).toEqual(['Артефакты', 'Записи', 'Файлы чатов'].sort())

    await harness.handle(accountCreated())
    expect(harness.list('drive-quota')).toHaveLength(1)
    expect(harness.list('folder')).toHaveLength(3)
  })

  test('one account runs R3 and R5, R3 first', async () => {
    const harness = createHarness({ authority: 'workspace' })
    const outcomes = await harness.handle(accountCreated())
    expect(outcomes.map(outcome => outcome.ruleId)).toEqual(['R3', 'R5'])
    expect((await harness.executions()).map(record => record.ruleId).sort()).toEqual(['R3', 'R5'])
  })
})

describe('the flag: consumers are inert when off', () => {
  test('no flag → nothing runs and nothing is written', async () => {
    const harness = createHarness({ flags: [] })
    expect(harness.engine.enabled).toBe(false)
    expect(await harness.handle(calendarEvent())).toEqual([])
    expect((await harness.executions())).toHaveLength(0)
    expect(harness.list('note')).toHaveLength(0)
    expect(harness.work.list('task-list')).toHaveLength(0)
    expect(tasks.list()).toHaveLength(0)
  })

  test('the consumer subscribes only while the flag is on', async () => {
    const off = createHarness({ flags: [] })
    off.consumer.attach()
    expect(off.consumer.attached).toBe(false)
    off.consumer.close()

    const on = createHarness({ authority: 'workspace' })
    const done = Promise.withResolvers<RuleRunOutcome>()
    const consumer = createLocalRulesConsumer({
      workspaceId: WS,
      workspaceRoot: root,
      bus,
      dispatch: input => on.executor.execute(input),
      executions: on.rules,
      settingsStore: on.rules,
      isFlagEnabled: flag => flag === AUTOMATION_RULES_FLAG,
      now: () => clock,
      onExecution: outcome => done.resolve(outcome),
    })
    consumer.attach()
    expect(consumer.attached).toBe(true)
    bus.publish([calendarEvent()])
    const outcome = await done.promise
    expect(outcome).toMatchObject({ ruleId: 'R1', status: 'succeeded' })
    consumer.detach()
    expect(consumer.attached).toBe(false)
    consumer.close()
  })

  test('R2–R5 are admin-managed; R1 params are validated', async () => {
    const harness = createHarness()
    const restricted = new RuleSettingsService({ store: harness.rules, workspaceId: WS, now: () => clock, isAdmin: async () => false })
    await expect(restricted.update('R2', { enabled: false }, { principalId: ORGANISER, isAdmin: false })).rejects.toThrow('managed by workspace admins')
    const view = await harness.settings.update('R3', { params: { handles: ['@rox', '@rox-anna'] } }, { principalId: ORGANISER, isAdmin: true })
    expect(view).toMatchObject({ ruleId: 'R3', scope: 'workspace', enabled: true, source: 'workspace' })
    expect(view.params).toEqual({ handles: ['@rox', '@rox-anna'] })
    await expect(harness.settings.update('R1', { params: { for: 'nonsense' } }, { principalId: ORGANISER, isAdmin: false })).rejects.toThrow('Invalid params')
  })
})