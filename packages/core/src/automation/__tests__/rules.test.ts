/**
 * W1-12 (#1509) — R1–R5 declarations: triggers, targets, conditions (the
 * negative cases of the acceptance criteria), idempotency keys and steps.
 */
import { describe, expect, test } from 'bun:test'
import type { DomainEvent } from '../../events/types'
import type { EntityRef } from '../../entities/refs'
import { dailyLinkBlockId, dailyNoteId } from '../../docs/daily'
import { AUTOMATION_RULES_FLAG, type RuleCtx, type RuleSettings } from '../rule'
import { DOMAIN_RULES, R1, R2, R3, R4, R5, readR1Params, r1Key, r1Owners, systemListId, welcomeMessageId } from '../rules'
import { calendarTriggerOf, memberAddedOf } from '../events'

const WS = 'ws-1'
const ORGANISER = 'principal-mark'
const ATTENDEE = 'principal-anna'
const AGENT = 'agent-mark'

function settingsOf(params: Record<string, unknown> = {}, enabled = true): RuleSettings {
  return { ruleId: 'R1', enabled, params, source: 'workspace' }
}

function ctx(subject: string, params: Record<string, unknown> = {}, token?: string): RuleCtx {
  const context: RuleCtx = {
    workspaceId: WS,
    subject,
    token,
    now: () => new Date('2026-10-08T09:00:00.000Z'),
    settings: async () => settingsOf(params),
    params: async () => params,
    isFlagEnabled: flag => flag === AUTOMATION_RULES_FLAG,
    generalChatId: async () => 'chat-general',
    personalAgent: async principal => (principal === ORGANISER ? AGENT : principal === ATTENDEE ? 'agent-anna' : undefined),
    directChatRef: async (owner, peer) => ({ kind: 'channel', id: `p2p:${owner}:${peer}` }),
    displayName: async principal => (principal === ORGANISER ? 'Марк' : undefined),
  }
  return context
}

function calendarEvent(overrides: Partial<Record<string, unknown>> = {}, type = 'calendar.event_created'): DomainEvent {
  const snapshot: Record<string, unknown> = {
    ref: { kind: 'calendar-event', id: 'event-1' },
    calendarId: 'calendar-1',
    title: 'Планёрка',
    startAt: '2026-10-09T07:00:00.000Z',
    endAt: '2026-10-09T07:30:00.000Z',
    allDay: false,
    organizerId: ORGANISER,
    attendeeIds: [ORGANISER, ATTENDEE],
    ...overrides,
  }
  const payload = type === 'calendar.occurrence_upcoming'
    ? { event: snapshot, occurrenceStart: '2026-10-09T07:00:00.000Z', occurrenceEnd: '2026-10-09T07:30:00.000Z' }
    : type === 'calendar.external_event_seen'
      ? { event: snapshot, provider: 'google', providerUid: 'uid-9' }
      : { event: snapshot }
  return {
    eventId: 'evt-1',
    workspaceId: WS,
    type: type as DomainEvent['type'],
    aggregateRevision: 1,
    payload,
    createdAt: '2026-10-08T09:00:00.000Z',
  }
}

describe('rule declarations', () => {
  test('all five rules exist with the declared triggers and scopes', () => {
    expect(DOMAIN_RULES.map(rule => rule.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect([...R1.triggers]).toEqual(['calendar.event_created', 'calendar.external_event_seen', 'calendar.occurrence_upcoming'])
    expect([...R2.triggers]).toEqual(['people.member_added'])
    expect([...R3.triggers]).toEqual(['identity.account_created'])
    expect([...R4.triggers]).toEqual(['people.invitations_sent'])
    expect([...R5.triggers]).toEqual(['identity.account_created'])
    expect(R1.scope).toBe('principal')
    expect([R2.scope, R3.scope, R4.scope, R5.scope]).toEqual(['workspace', 'workspace', 'workspace', 'workspace'])
  })

  test('R3 and R5 share the identity trigger; R2 and R3 share one agent command id', async () => {
    const created: DomainEvent = {
      eventId: 'evt-account', workspaceId: WS, type: 'identity.account_created', aggregateRevision: 1,
      payload: { principalId: ORGANISER, source: 'oidc', verified: true }, createdAt: '2026-10-08T09:00:00.000Z',
    }
    const r3Steps = await R3.steps(ctx(ORGANISER), created)
    const r5Steps = await R5.steps(ctx(ORGANISER), created)
    expect(r3Steps.map(step => step.name)).toEqual(['provision-agent', 'open-agent-dm', 'seed-starter-content', 'send-welcome'])
    expect(r5Steps.map(step => step.name)).toEqual(['provision-drive', 'folder:Артефакты', 'folder:Файлы чатов', 'folder:Записи'])

    const member: DomainEvent = {
      eventId: 'evt-member', workspaceId: WS, type: 'people.member_added', aggregateRevision: 1,
      payload: { principalId: ORGANISER }, createdAt: '2026-10-08T09:00:00.000Z',
    }
    const r2Steps = await R2.steps(ctx(ORGANISER), member)
    const provision = (steps: readonly { name: string; commandId?: string }[]): string | undefined =>
      steps.find(step => step.name === 'provision-agent')?.commandId
    expect(provision(r2Steps)).toBe('R-agent:ws-1:principal-mark')
    expect(provision(r3Steps)).toBe(provision(r2Steps))
  })
})

describe('R1 key and targets (DATA-MODEL §5.16)', () => {
  test('workspace-native events key on the event id', async () => {
    const event = calendarEvent()
    const trigger = calendarTriggerOf(event)!
    expect(r1Key(ORGANISER, trigger)).toBe('R1:event-1:single:principal-mark')
    expect(await R1.key(ctx(ORGANISER), event)).toBe('R1:event-1:single:principal-mark')
  })

  test('recurring occurrences key on the occurrence start', () => {
    const trigger = calendarTriggerOf(calendarEvent({}, 'calendar.occurrence_upcoming'))!
    expect(r1Key(ORGANISER, trigger)).toBe('R1:event-1:2026-10-09T07:00:00.000Z:principal-mark')
  })

  test('external events key on the provider uid (first sight only)', () => {
    const trigger = calendarTriggerOf(calendarEvent({}, 'calendar.external_event_seen'))!
    expect(trigger.kind).toBe('external')
    expect(r1Key(ORGANISER, trigger)).toBe('R1:uid-9:single:principal-mark')
  })

  test('D-v2-3: the organiser is the only owner by default; the param widens it', () => {
    const trigger = calendarTriggerOf(calendarEvent())!
    expect(r1Owners(trigger, readR1Params({}))).toEqual([ORGANISER])
    expect(r1Owners(trigger, readR1Params({ for: 'all_rox_attendees' }))).toEqual([ATTENDEE, ORGANISER].sort())
  })

  test('targets: one execution per owner', async () => {
    const event = calendarEvent()
    expect(await R1.targets(ctx(ORGANISER), event)).toEqual([{ subject: ORGANISER }])
    expect(await R1.targets(ctx(ORGANISER, { for: 'all_rox_attendees' }), event)).toEqual([{ subject: ATTENDEE }, { subject: ORGANISER }])
  })
})

describe('R1 conditions — the negative cases of D-v2-3', () => {
  const cases: Array<[string, Partial<Record<string, unknown>>, string]> = [
    ['all-day events are skipped', { allDay: true }, 'all_day'],
    ['declined events are skipped', { declinedByIds: [ORGANISER] }, 'declined'],
    ['free events are skipped', { transparency: 'free' }, 'free'],
    ['#no-notes events are skipped', { keywords: ['#no-notes'] }, 'no_notes_keyword'],
    ['a #no-notes title is skipped', { title: 'Созвон #no-notes' }, 'no_notes_keyword'],
    ['cancelled events are skipped', { status: 'cancelled' }, 'event_cancelled'],
  ]
  for (const [name, overrides, reason] of cases) {
    test(name, async () => {
      const event = calendarEvent(overrides)
      expect(await R1.conditions(ctx(ORGANISER), event)).toBe(reason as never)
    })
  }

  test('a decline only skips the owner, not everybody', async () => {
    const event = calendarEvent({ declinedByIds: [ORGANISER] })
    expect(await R1.conditions(ctx(ORGANISER), event)).toBe('declined')
    expect(await R1.conditions(ctx(ATTENDEE), event)).toBeNull()
  })

  test('an event without an organiser has no R1 owner and is skipped', async () => {
    const event = calendarEvent({ organizerId: undefined })
    expect(r1Owners(calendarTriggerOf(event)!, readR1Params({}))).toEqual([])
    expect(await R1.conditions(ctx(ATTENDEE), event)).toBe('not_organiser')
  })

  test('R1 honours the skipAllDay opt-out param', async () => {
    const event = calendarEvent({ allDay: true })
    expect(await R1.conditions(ctx(ORGANISER, { skipAllDay: false }), event)).toBeNull()
  })

  test('enabled() reads automation_rule (per-user override)', async () => {
    expect(await R1.enabled(ctx(ORGANISER), calendarEvent())).toBe(true)
    const disabled: RuleCtx = { ...ctx(ORGANISER), settings: async () => settingsOf({}, false) }
    expect(await R1.enabled(disabled, calendarEvent())).toBe(false)
  })
})

describe('R1 steps (D-v2-3 / D-v2-4)', () => {
  test('six artifacts: backlog list, daily note, minutes, in-place daily link, prep task and links', async () => {
    const event = calendarEvent()
    const steps = await R1.steps(ctx(ORGANISER), event)
    expect(steps.map(step => step.name)).toEqual([
      'ensure-backlog-list', 'ensure-daily-note', 'create-minutes', 'append-daily-link',
      'create-prep-task', 'link-minutes-event', 'link-task-event', 'link-minutes-daily',
    ])
    const ownerRef: EntityRef = { kind: 'person', id: ORGANISER }
    const key = 'R1:event-1:single:principal-mark'

    const listStep = steps[0]!
    expect(listStep.command.type).toBe('task_lists.ensure_system_list')
    expect(listStep.command.payload).toEqual({ systemKey: 'backlog', ownerId: ORGANISER, id: systemListId(WS, ORGANISER, 'backlog') })
    expect(listStep.command.target).toEqual(ownerRef)

    const dailyStep = steps[1]!
    const dailyId = (dailyStep.command.payload as { id: string }).id
    expect(dailyStep.command.payload).toEqual({ date: '2026-10-09', ownerId: ORGANISER, id: dailyNoteId(WS, ORGANISER, '2026-10-09') })
    expect(dailyStep.command.target).toEqual(ownerRef)

    const minutesStep = steps[2]!
    const minutesId = (minutesStep.command.payload as { id: string }).id
    expect(minutesStep.command.type).toBe('docs.create_meeting_notes')
    expect(minutesStep.command.payload).toEqual({ id: minutesId, eventRef: { kind: 'calendar-event', id: 'event-1' }, title: 'Планёрка' })
    expect(minutesStep.command.target).toEqual(ownerRef)

    const prep = steps[4]!
    const taskId = (prep.command.payload as { id: string }).id
    expect(prep.command.type).toBe('tasks.create')
    expect(prep.command.payload).toEqual({
      id: taskId,
      title: 'Подготовиться: Планёрка',
      listId: systemListId(WS, ORGANISER, 'backlog'),
      dueAt: '2026-10-09T07:00:00.000Z',
      origin: { kind: 'calendar-event', id: 'event-1' },
      customFields: { draft: true },
    })
    expect(prep.command.target).toEqual(ownerRef)

    const link = steps[3]!
    expect(link.command.type).toBe('docs.append_daily_link')
    expect(link.command.payload).toEqual({
      date: '2026-10-09', ownerId: ORGANISER, id: dailyId,
      link: { kind: 'note', id: minutesId }, label: 'Планёрка',
      blockId: dailyLinkBlockId(key), time: '2026-10-09T07:00:00.000Z',
    })

    const links = steps.filter(step => step.command.type === 'links.add')
    expect(links.map(step => (step.command.payload as { relation: string }).relation)).toEqual(['attached-to', 'derived-from', 'parent'])
    expect((links[0]!.command.payload as { role: string }).role).toBe('minutes')
    expect(taskId).not.toBe(minutesId)
  })

  test('the daily link block id is stable per key and differs across occurrences', () => {
    expect(dailyLinkBlockId('R1:event-1:single:principal-mark')).toBe(dailyLinkBlockId('R1:event-1:single:principal-mark'))
    expect(dailyLinkBlockId('R1:event-1:single:principal-mark')).not.toBe(dailyLinkBlockId('R1:event-1:2026-10-10T07:00:00.000Z:principal-mark'))
  })

  test('a different owner gets their own artifacts (one execution each)', async () => {
    const event = calendarEvent()
    const mark = await R1.steps(ctx(ORGANISER), event)
    const anna = await R1.steps(ctx(ATTENDEE, { for: 'all_rox_attendees' }), event)
    const ids = (steps: readonly { name: string; command: { payload: Record<string, unknown> } }[]): string[] =>
      steps.map(step => String(step.command.payload.id ?? '')).filter(Boolean)
    expect(ids(mark)).not.toEqual(ids(anna))
    for (const id of ids(mark)) expect(ids(anna)).not.toContain(id)
  })

  test('the minutes note and the prep task are linked to the event and the daily note', async () => {
    const steps = await R1.steps(ctx(ORGANISER), calendarEvent())
    const minutesId = (steps[2]!.command.payload as { id: string }).id
    const taskId = (steps[4]!.command.payload as { id: string }).id
    const dailyId = (steps[1]!.command.payload as { id: string }).id
    expect(steps[5]!.command.payload).toEqual({ from: { kind: 'note', id: minutesId }, to: { kind: 'calendar-event', id: 'event-1' }, relation: 'attached-to', role: 'minutes' })
    expect(steps[6]!.command.payload).toEqual({ from: { kind: 'task', id: taskId }, to: { kind: 'calendar-event', id: 'event-1' }, relation: 'derived-from' })
    expect(steps[7]!.command.payload).toEqual({ from: { kind: 'note', id: minutesId }, to: { kind: 'note', id: dailyId }, relation: 'parent' })
    expect(minutesId).not.toBe(taskId)
  })
})

describe('R2 / R3 / R4 / R5 conditions', () => {
  test('R2 skips when the workspace has no General chat and for invited members', async () => {
    const member: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'people.member_added', aggregateRevision: 1, payload: { principalId: ATTENDEE }, createdAt: '2026-10-08T09:00:00.000Z' }
    expect(await R2.conditions(ctx(ATTENDEE), member)).toBeNull()
    const noChat: RuleCtx = { ...ctx(ATTENDEE), generalChatId: async () => undefined }
    expect(await R2.conditions(noChat, member)).toBe('no_general_chat')
    const invited: DomainEvent = { ...member, payload: { principalId: ATTENDEE, status: 'invited' } }
    expect(await R2.conditions(ctx(ATTENDEE), invited)).toBe('not_active_member')
    expect(memberAddedOf(invited)?.principalId).toBe(ATTENDEE)
  })

  test('R2 falls back to the event subject when the payload is a reference event', async () => {
    const reference: DomainEvent = {
      eventId: 'e', workspaceId: WS, type: 'people.member_added', aggregateRevision: 1,
      subject: { kind: 'person', id: ATTENDEE },
      payload: { reference: true, command: 'people.add_workspace_member', collection: 'person', id: ATTENDEE, changes: ['role'] },
      createdAt: '2026-10-08T09:00:00.000Z',
    }
    expect(memberAddedOf(reference)?.principalId).toBe(ATTENDEE)
    expect(await R2.targets(ctx(ATTENDEE), reference)).toEqual([{ subject: ATTENDEE }])
  })

  test('R3 skips when the agent cannot be resolved', async () => {
    const created: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'identity.account_created', aggregateRevision: 1, payload: { principalId: 'principal-bob', verified: true }, createdAt: '2026-10-08T09:00:00.000Z' }
    expect(await R3.conditions(ctx('principal-bob'), created)).toBe('no_agent')
    expect(await R3.conditions(ctx(ORGANISER), created)).toBeNull()
  })

  test('R4 expands one execution per invited email', async () => {
    const invited: DomainEvent = {
      eventId: 'e', workspaceId: WS, type: 'people.invitations_sent', aggregateRevision: 1,
      payload: { invitedBy: ORGANISER, invitations: [{ email: 'Anna@Example.com', role: 'member' }, { email: 'bob@example.com' }] },
      createdAt: '2026-10-08T09:00:00.000Z',
    }
    expect(await R4.targets(ctx(ORGANISER), invited)).toEqual([
      { subject: ORGANISER, token: 'anna@example.com' },
      { subject: ORGANISER, token: 'bob@example.com' },
    ])
    expect(await R4.key(ctx(ORGANISER, {}, 'anna@example.com'), invited)).toBe('R4:ws-1:anna@example.com')
    const steps = await R4.steps(ctx(ORGANISER, {}, 'anna@example.com'), invited)
    // W1-11 (#1508) `identity.ensure_placeholder` owns the placeholder, its
    // member row and (from `chatIds`) the General-chat membership.
    expect(steps.map(step => step.name)).toEqual(['ensure-placeholder', 'send-invite-email'])
    expect(steps[0]!.command.type).toBe('identity.ensure_placeholder')
    expect(steps[0]!.command.payload).toEqual({
      workspaceId: WS, email: 'anna@example.com', invitedBy: ORGANISER, role: 'member', chatIds: ['chat-general'],
    })
    expect(steps[1]!.commandId).toBe('R4-invite:ws-1:anna@example.com')
    expect(steps[1]!.command.payload).toEqual({ email: 'anna@example.com', role: 'member', workspaceId: WS })
  })

  test('R5 provisions the personal drive with the D-v2-8 quota', async () => {
    const created: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'identity.account_created', aggregateRevision: 1, payload: { principalId: ORGANISER }, createdAt: '2026-10-08T09:00:00.000Z' }
    expect(await R5.key(ctx(ORGANISER), created)).toBe('R5:principal-mark')
    const steps = await R5.steps(ctx(ORGANISER), created)
    expect((steps[0]!.command.payload as { quotaBytes: number }).quotaBytes).toBe(1024 ** 4)
    expect(steps.slice(1).every(step => step.optional === true)).toBe(true)
  })
})

describe('R2/R3 actor and welcome contract', () => {
  test('the welcome runs as the agent principal with mentions-only notification', async () => {
    const created: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'identity.account_created', aggregateRevision: 1, payload: { principalId: ORGANISER, verified: true }, createdAt: '2026-10-08T09:00:00.000Z' }
    const steps = await R3.steps(ctx(ORGANISER), created)
    const welcome = steps.find(step => step.name === 'send-welcome')!
    expect(welcome.actor).toEqual({ agentOf: ORGANISER })
    expect(welcome.command.type).toBe('im.send_message')
    expect(welcome.command.payload.attribution).toBe('unprompted')
    expect(welcome.command.payload.notify).toBe('mentions_only')
    // W1-14 (#1511) `@rox/shared/xsc`: the copy is `body`, the mentioned people
    // are principal ids, and `messageId` carries the deterministic welcome id.
    const body = welcome.command.payload.body
    expect(body && typeof body === 'object' && 'doc' in body ? String(body.doc) : '').toContain('Привет, Марк!')
    expect(welcome.command.payload.mentions).toEqual([ORGANISER])
    expect(welcome.command.payload.messageId).toBe(welcomeMessageId(ORGANISER))
    expect(welcome.command.target).toEqual({ kind: 'channel', id: `p2p:${ORGANISER}:${AGENT}` })
  })

  test('R2 step 1 targets the General chat and step 2 acts for the joining member', async () => {
    const member: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'people.member_added', aggregateRevision: 1, payload: { principalId: ATTENDEE }, createdAt: '2026-10-08T09:00:00.000Z' }
    const steps = await R2.steps(ctx(ATTENDEE), member)
    expect(steps[0]!.command.target).toEqual({ kind: 'channel', id: 'chat-general' })
    expect(steps[0]!.command.payload).toEqual({ memberIds: [ATTENDEE] })
    expect(steps[1]!.command.payload).toEqual({ workspaceId: WS, ownerPrincipalId: ATTENDEE })
  })

  test('R2 posts no join card when the announce param is off', async () => {
    const member: DomainEvent = { eventId: 'e', workspaceId: WS, type: 'people.member_added', aggregateRevision: 1, payload: { principalId: ATTENDEE }, createdAt: '2026-10-08T09:00:00.000Z' }
    const steps = await R2.steps(ctx(ATTENDEE, { announce: false }), member)
    expect(steps.map(step => step.name)).toEqual(['join-general-chat', 'provision-agent'])
  })
})