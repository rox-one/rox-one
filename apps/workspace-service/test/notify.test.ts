/**
 * W1-09 (#1506) — notify module: fan-out, audience rules, ACL, preferences,
 * mark-read over the `user:{id}` topic, the mark-read route and the email
 * batching worker.
 *
 * The "reference handler" of the exit criterion is the W1-06 goal handler.
 * Without `feat/w1-06-workitem-v3-schemas` in this base, the suite binds a
 * minimal goal reference handler that emits the same `goals.*` domain events
 * with the same ids (`championId`, `reviewerId`, `subscriberIds`,
 * `check_in.notify`); the assertions do not change when the real handler lands.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DomainEvent, RealtimeEventFrame } from '../../../packages/core/src/events/index.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { createWiredCommandRegistry, type WiredCommandRegistryOptions } from '../../../packages/server-core/src/commands/registry.ts'
import type { CommandRegistry } from '../../../packages/core/src/commands/index.ts'
import { setNotifyCommandHost } from '../../../packages/core/src/notify/index.ts'
import type { CommandReceipt } from '../../../packages/core/src/commands/index.ts'
import { commandReceiptSchema } from '../../../packages/shared/src/commands/schemas.ts'
import {
  notificationListResultSchema,
  notificationReadResultSchema,
} from '../../../packages/shared/src/notify/schemas.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER, type WorkspaceAuthorizer } from '../src/modules/commands/authorizer.ts'
import { DomainEventRelay } from '../src/modules/events/relay.ts'
import { createNotifyModule, type NotifyModule } from '../src/modules/notify/index.ts'
import { InMemoryNotificationStore } from '../src/modules/notify/store.ts'
import type { NotificationEmailTransport } from '../src/modules/notify/email-worker.ts'
import { actor, fakeResolver, request, serve, type TestHttpResult, type TestServer } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  setNotifyCommandHost(null)
})

const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority

const GOAL = '11111111-1111-4111-8111-111111111111'
const CHAMPION = '22222222-2222-4222-8222-222222222222'
const REVIEWER = '33333333-3333-4333-8333-333333333333'
const SUBSCRIBER_A = '44444444-4444-4444-8444-444444444444'
const SUBSCRIBER_B = '55555555-5555-4555-8555-555555555555'
const OUTSIDER = '66666666-6666-4666-8666-666666666666'
/** The member who edits the goal: an actor who is not in the notified audience. */
const EDITOR = '77777777-7777-4777-8777-777777777777'
const SECRET = 'Confidential: the acquisition plan'

/** Payloads the fixture reference handlers accept (validated, not assumed). */
const championPayload = z.object({ championId: z.string().min(1) })
const checkInPayload = z.object({
  reviewerId: z.string().min(1),
  subscriberIds: z.array(z.string().min(1)),
  notify: z.enum(['everyone', 'selected', 'none']),
  title: z.string().optional(),
})
const commentPayload = z.object({ subscriberIds: z.array(z.string().min(1)) })

/** Minimal goal/comment reference handlers (W1-06 #1503 binds the real ones). */
function bindReferenceHandlers(registry: CommandRegistry, calls: { n: number }): void {
  registry.bind('goals.update_champion', ctx => {
    const payload = championPayload.parse(ctx.payload)
    calls.n += 1
    return {
      ref: { kind: 'goal', id: GOAL },
      revision: calls.n,
      events: [{ type: 'goals.goal_champion_updating', payload: { championId: payload.championId } }],
    }
  })
  registry.bind('goals.create_check_in', ctx => {
    const payload = checkInPayload.parse(ctx.payload)
    calls.n += 1
    return {
      ref: { kind: 'goal', id: GOAL },
      revision: calls.n,
      events: [{
        type: 'goals.goal_check_in',
        payload: {
          refs: [{ kind: 'goal', id: GOAL }],
          reviewerId: payload.reviewerId,
          subscriberIds: payload.subscriberIds,
          allSubscriberIds: payload.subscriberIds,
          notify: payload.notify,
          title: payload.title,
          body: payload.title,
        },
      }],
    }
  })
  registry.bind('comments.create', ctx => {
    const payload = commentPayload.parse(ctx.payload)
    calls.n += 1
    return {
      ref: { kind: 'task', id: GOAL },
      revision: calls.n,
      events: [{ type: 'entities.comment_added', payload: { refs: [{ kind: 'task', id: GOAL }], subscriberIds: payload.subscriberIds } }],
    }
  })
}

interface NotifyFixture {
  workspaceId: string
  registry: CommandRegistry
  notifications: InMemoryNotificationStore
  bus: InProcessEventBus
  relay: DomainEventRelay
  http: TestServer
  notify: NotifyModule
  calls: { n: number }
  frames: RealtimeEventFrame[]
  state: ReturnType<typeof fakeResolver>['state']
  post(body: unknown, token?: string): Promise<TestHttpResult>
  get(query: string, token?: string | null): Promise<TestHttpResult>
  read(body: unknown): Promise<TestHttpResult>
}

async function setup(options: { authorizer?: WorkspaceAuthorizer; notify?: boolean; module?: boolean; outboundEmail?: boolean; transport?: NotificationEmailTransport | null } = {}): Promise<NotifyFixture> {
  const workspaceId = randomUUID()
  const author = actor([workspaceId], EDITOR)
  const { resolver, state } = fakeResolver(author)
  const commandStore = new InMemoryCommandStore()
  const notifications = new InMemoryNotificationStore()
  const bus = new InProcessEventBus({ epoch: 'epoch-1' })
  const frames: RealtimeEventFrame[] = []
  bus.subscribe((_ws, frame) => frames.push(frame))
  const authorizer = options.authorizer ?? WORKSPACE_MEMBER_AUTHORIZER
  const notify = createNotifyModule({
    store: notifications,
    authorizer,
    push: (ws, publications) => { bus.publishPublications(ws, publications) },
    outboundEmail: options.outboundEmail ?? false,
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
  })
  // The host must exist before the registry is built: that is what binds `notifications.*`.
  if (options.module !== false) setNotifyCommandHost(notify.host)
  const flags = new Set(['goals.v1', 'goals.checkins.v1'])
  const registryOptions: WiredCommandRegistryOptions = { isFlagEnabled: flag => flags.has(flag) }
  const registry = createWiredCommandRegistry(registryOptions)
  const calls = { n: 0 }
  bindReferenceHandlers(registry, calls)
  let relay: DomainEventRelay
  const service = new WorkspaceCommandService({ store: commandStore, registry, authorizer, publish: events => { void relay.publish(events) } })
  relay = new DomainEventRelay({ store: commandStore, sinks: [events => { bus.publish(events) }, async events => { await notify.ingest(events) }] })
  await relay.start()
  const http = await serve({
    authority: unusedAuthority,
    actorResolver: resolver,
    commandBus: service,
    ...(options.notify === false ? {} : { notify: notify.http }),
  })
  closers.push(http.close, () => relay.close())
  return {
    workspaceId,
    registry,
    notifications,
    bus,
    relay,
    http,
    notify,
    calls,
    frames,
    state,
    post: (body, token) => request(http.url, `/v1/workspaces/${workspaceId}/commands`, { body, ...(token ? { token } : {}) }),
    get: (query, token) => request(http.url, `/v1/workspaces/${workspaceId}/notifications${query}`, { method: 'GET', token: token === undefined ? undefined : token }),
    read: body => request(http.url, `/v1/workspaces/${workspaceId}/notifications/read`, { body }),
  }
}

const envelope = (type: string, payload: unknown) =>
  ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString() })

const receipt = (result: TestHttpResult): CommandReceipt => commandReceiptSchema.parse(result.body)

const received = (fixture: NotifyFixture, principalId: string) => fixture.notifications.all(fixture.workspaceId, principalId)

describe('notify fan-out over the command bus', () => {
  test('a goal update notifies champion, reviewer and subscribers — never the actor or an outsider', async () => {
    const f = await setup()
    const champion = await f.post(envelope('goals.update_champion', { championId: CHAMPION }))
    expect(receipt(champion)).toMatchObject({ status: 'applied' })
    const checkIn = await f.post(envelope('goals.create_check_in', {
      reviewerId: REVIEWER,
      subscriberIds: [SUBSCRIBER_A, SUBSCRIBER_B],
      notify: 'everyone',
      title: SECRET,
    }))
    expect(receipt(checkIn)).toMatchObject({ status: 'applied' })
    await f.relay.idle()

    expect(f.calls.n).toBe(2)
    expect(received(f, CHAMPION).map(row => row.kind)).toEqual(['assignment'])
    expect(received(f, REVIEWER).map(row => row.kind)).toEqual(['check_in_submitted'])
    expect(received(f, SUBSCRIBER_A).map(row => row.kind)).toEqual(['check_in_submitted'])
    expect(received(f, SUBSCRIBER_B).map(row => row.kind)).toEqual(['check_in_submitted'])
    expect(received(f, OUTSIDER)).toEqual([])
    // The editor authored both updates: they are never notified about their own action.
    expect(received(f, EDITOR)).toEqual([])
    // The champion publishes a check-in themselves: still nothing for the actor.
    f.state.actor = actor([f.workspaceId], CHAMPION)
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A, SUBSCRIBER_B], notify: 'everyone' }))
    await f.relay.idle()
    expect(received(f, CHAMPION).map(row => row.kind)).toEqual(['assignment'])
    expect(received(f, REVIEWER).map(row => row.kind)).toEqual(['check_in_submitted', 'check_in_submitted'])

    const reviewerRow = received(f, REVIEWER)[0]!
    expect(reviewerRow).toMatchObject({
      workspaceId: f.workspaceId,
      principalId: REVIEWER,
      kind: 'check_in_submitted',
      subject: { kind: 'goal', id: GOAL },
      actorId: EDITOR,
      schemaVersion: 1,
    })
    // No restricted content: ids only, the title never leaves the entity store.
    expect(JSON.stringify(reviewerRow.payload)).not.toContain('Confidential')
    expect(reviewerRow.payload.refs).toEqual([{ kind: 'goal', id: GOAL }])
  })

  test('pushes notification.created on user:{id} for every recipient', async () => {
    const f = await setup()
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone', title: SECRET }))
    await f.relay.idle()
    const created = f.frames.filter(frame => frame.type === 'notification.created')
    expect(created.map(frame => frame.topic)).toEqual([`user:${REVIEWER}`])
    expect(created[0]?.payload).toMatchObject({ notification: { principalId: REVIEWER, kind: 'check_in_submitted' } })
    expect(JSON.stringify(created[0]?.payload)).not.toContain('Confidential')
  })

  test('ingesting the same event twice writes one notification per recipient', async () => {
    const f = await setup()
    const event: DomainEvent = {
      eventId: 'evt-1',
      workspaceId: f.workspaceId,
      type: 'goals.goal_check_in',
      actorId: CHAMPION,
      aggregateRevision: 1,
      subject: { kind: 'goal', id: GOAL },
      payload: { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A], allSubscriberIds: [SUBSCRIBER_A], notify: 'everyone' },
      createdAt: '2026-10-08T10:00:00.000Z',
    }
    const first = await f.notify.ingest([event])
    const retry = await f.notify.ingest([event])
    expect(first.created).toBe(2)
    expect(retry.created).toBe(0)
    expect(received(f, REVIEWER)).toHaveLength(1)
    expect(received(f, SUBSCRIBER_A)).toHaveLength(1)
  })

  test('does not notify a recipient who cannot read the subject', async () => {
    const blocking: WorkspaceAuthorizer = {
      async can(principal, action) { return action === 'read' ? principal.principalId !== SUBSCRIBER_B : true },
      async canReadTopic() { return true },
    }
    const f = await setup({ authorizer: blocking })
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A, SUBSCRIBER_B], notify: 'everyone' }))
    await f.relay.idle()
    expect(received(f, REVIEWER)).toHaveLength(1)
    expect(received(f, SUBSCRIBER_A)).toHaveLength(1)
    expect(received(f, SUBSCRIBER_B)).toEqual([])
  })

  test('a muted kind is not delivered and resumes when unmuted', async () => {
    const f = await setup()
    await f.notify.service.updatePrefs(f.workspaceId, REVIEWER, [{ kind: 'check_in_submitted', enabled: false }])
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone' }))
    await f.relay.idle()
    expect(received(f, REVIEWER)).toEqual([])

    await f.notify.service.updatePrefs(f.workspaceId, REVIEWER, [{ kind: 'check_in_submitted', enabled: true }])
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone' }))
    await f.relay.idle()
    expect(received(f, REVIEWER).map(row => row.kind)).toEqual(['check_in_submitted'])
  })

  test('a silent check-in (notify: none) notifies nobody, and selected keeps subscribers out', async () => {
    const silent = await setup()
    await silent.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A], notify: 'none' }))
    await silent.relay.idle()
    expect(silent.notifications.all(silent.workspaceId)).toEqual([])

    const selected = await setup()
    await selected.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A], notify: 'selected' }))
    await selected.relay.idle()
    expect(received(selected, REVIEWER)).toHaveLength(1)
    expect(received(selected, SUBSCRIBER_A)).toEqual([])
  })
})

describe('mark-read', () => {
  test('marks rows read over the command bus, isolates principals and pushes notification.read', async () => {
    const f = await setup()
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [SUBSCRIBER_A], notify: 'everyone' }))
    await f.relay.idle()
    const reviewerRow = received(f, REVIEWER)[0]!
    const subscriberRow = received(f, SUBSCRIBER_A)[0]!
    f.frames.length = 0
    f.state.actor = actor([f.workspaceId], REVIEWER)

    expect(notificationListResultSchema.parse((await f.get('')).body).unread).toBe(1)
    // Another principal's id is not the caller's to mark.
    expect(receipt(await f.post(envelope('notifications.mark_read', { ids: [subscriberRow.notificationId] }))))
      .toMatchObject({ status: 'applied', result: { updated: 0 } })
    expect(received(f, SUBSCRIBER_A)[0]?.readAt).toBeUndefined()

    expect(receipt(await f.post(envelope('notifications.mark_read', { ids: [reviewerRow.notificationId] }))))
      .toMatchObject({ status: 'applied', result: { updated: 1 } })
    const read = f.frames.filter(frame => frame.type === 'notification.read')
    expect(read.map(frame => frame.topic)).toEqual([`user:${REVIEWER}`])
    expect(read[0]?.payload).toMatchObject({ ids: [reviewerRow.notificationId], unread: 0 })
    // The frame must be sequenced in the *workspace's* realtime log — the one the
    // gateway replays and pushes from — never in a log keyed by the recipient.
    const logged = f.bus.replay(f.workspaceId, `user:${REVIEWER}`, 0)
    expect(logged.kind === 'events' ? logged.frames.map(frame => frame.type) : []).toEqual(['notification.created', 'notification.read'])
    const listed = notificationListResultSchema.parse((await f.get('')).body)
    expect(listed).toMatchObject({ unread: 0 })
    expect(listed.notifications[0]).toMatchObject({ notificationId: reviewerRow.notificationId, readAt: expect.any(String) })

    // The dedicated endpoint is the same code path.
    f.state.actor = actor([f.workspaceId], SUBSCRIBER_A)
    expect(notificationReadResultSchema.parse((await f.read({ all: true })).body)).toMatchObject({ updated: 1, unread: 0 })
  })

  test('mark_all_read with a kind only touches that kind', async () => {
    const f = await setup()
    await f.post(envelope('goals.update_champion', { championId: REVIEWER }))
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone' }))
    await f.relay.idle()
    f.state.actor = actor([f.workspaceId], REVIEWER)
    expect(received(f, REVIEWER).map(row => row.kind)).toEqual(['assignment', 'check_in_submitted'])
    expect(receipt(await f.post(envelope('notifications.mark_all_read', { kind: 'assignment' }))))
      .toMatchObject({ status: 'applied', result: { updated: 1 } })
    const rows = received(f, REVIEWER)
    expect(rows.find(row => row.kind === 'assignment')?.readAt).toBeDefined()
    expect(rows.find(row => row.kind === 'check_in_submitted')?.readAt).toBeUndefined()
  })

  test('update_prefs stores a filter and rejects unknown kinds or channels', async () => {
    const f = await setup()
    expect(receipt(await f.post(envelope('notifications.update_prefs', { prefs: [{ kind: 'comment', enabled: false, channels: ['inbox'], batchMinutes: 30 }] }))))
      .toMatchObject({ status: 'applied', result: { updated: 1 } })
    const stored = await f.notify.service.updatePrefs(f.workspaceId, EDITOR, [{ kind: 'comment', batchMinutes: 60 }])
    expect(stored.prefs[0]).toMatchObject({ kind: 'comment', enabled: false, batchMinutes: 60 })
    expect(receipt(await f.post(envelope('notifications.update_prefs', { prefs: [{ kind: 'not_a_kind' }] }))))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(receipt(await f.post(envelope('notifications.update_prefs', { prefs: [{ kind: 'comment', channels: ['email'] }] }))))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(receipt(await f.post(envelope('notifications.update_prefs', { prefs: [{ kind: 'comment', batchMinutes: 5000 }] }))))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    // The service is defensive too, for callers that bypass the command schema.
    const dropped = await f.notify.service.updatePrefs(f.workspaceId, EDITOR, [{ kind: 'nope' as never, channels: ['email'] as never }])
    expect(dropped).toMatchObject({ updated: 0, prefs: [] })
  })
})

describe('notify HTTP surface', () => {
  test('without the module both paths answer 404 and the commands stay unbound', async () => {
    const f = await setup({ notify: false, module: false })
    expect(await f.get('')).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } })
    expect(await f.read({ all: true })).toMatchObject({ status: 404 })
    expect(f.registry.handler('notifications.mark_read')).toBeUndefined()
    expect(f.registry.capability('notifications.mark_read')).toMatchObject({ available: false, reason: 'not_bound' })
    // The command bus still answers, with the honest capability reason.
    expect(receipt(await f.post(envelope('notifications.mark_read', { ids: ['x'] }))))
      .toMatchObject({ status: 'rejected', error: { code: 'NOT_BOUND' } })
  })

  test('with the module the commands are bound and capability discovery says so', async () => {
    const f = await setup()
    for (const type of ['notifications.mark_read', 'notifications.mark_all_read', 'notifications.update_prefs']) {
      expect(f.registry.capability(type)).toMatchObject({ available: true, module: 'notify', authority: 'workspace' })
    }
  })

  test('rejects unauthenticated, foreign-workspace, wrong-method and bad-body calls', async () => {
    const f = await setup()
    expect(await f.get('', 'bad.token.value')).toMatchObject({ status: 401 })
    expect(await request(f.http.url, `/v1/workspaces/${randomUUID()}/notifications`, {})).toMatchObject({ status: 403 })
    expect(await request(f.http.url, `/v1/workspaces/${f.workspaceId}/notifications`, { method: 'POST', body: {} })).toMatchObject({ status: 405 })
    expect(await request(f.http.url, `/v1/workspaces/${f.workspaceId}/notifications`, { method: 'PATCH' })).toMatchObject({ status: 405 })
    expect(await f.read({ ids: [] })).toMatchObject({ status: 400 })
    expect(await f.read({ all: true, kind: 'nope' })).toMatchObject({ status: 400 })
    expect(await f.read({ ids: ['x'], extra: 1 })).toMatchObject({ status: 400 })
    expect(await f.get('?limit=0')).toMatchObject({ status: 400 })
    expect(await f.get('?limit=1&cursor=not-a-uuid')).toMatchObject({ status: 400 })
    // A revoked session mid-call keeps the result private.
    f.state.revokeAfter = 0
    expect(await f.get('')).toMatchObject({ status: 401 })
  })

  test('pages the Inbox list and never shows another principal rows', async () => {
    const f = await setup()
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone' }))
    await f.relay.idle()
    f.state.actor = actor([f.workspaceId], REVIEWER)
    const page = notificationListResultSchema.parse((await f.get('?limit=1')).body)
    expect(page.notifications).toHaveLength(1)
    expect(page.notifications[0]?.principalId).toBe(REVIEWER)
    expect(page.nextCursor).toBeUndefined()
    f.state.actor = actor([f.workspaceId], OUTSIDER)
    expect(notificationListResultSchema.parse((await f.get('')).body).notifications).toEqual([])
  })
})

describe('email batching worker', () => {
  test('holds email-bound notifications and skips them when no transport is configured', async () => {
    const f = await setup({ outboundEmail: true, transport: null })
    expect(f.notify.service.worker.outboundConfigured()).toBe(false)
    // `check_in_submitted` is in-app only: nothing is held or batched for it.
    await f.post(envelope('goals.create_check_in', { reviewerId: REVIEWER, subscriberIds: [], notify: 'everyone' }))
    await f.relay.idle()
    expect(received(f, REVIEWER)[0]?.emailState).toBeUndefined()
    expect(f.notifications.batches()).toEqual([])

    // `comment` carries a digest: held, then skipped once its window closes.
    await f.post(envelope('comments.create', { subscriberIds: [SUBSCRIBER_A] }))
    await f.relay.idle()
    const comment = received(f, SUBSCRIBER_A)[0]!
    expect(comment).toMatchObject({ kind: 'comment', emailState: 'held' })
    const [batch] = f.notifications.batches()
    expect(batch).toMatchObject({ principalId: SUBSCRIBER_A, status: 'pending', windowMinutes: 5 })
    expect(await f.notify.service.worker.runOnce(new Date(Date.parse(batch!.sendAt) - 1000))).toMatchObject({ due: 0 })

    const summary = await f.notify.service.worker.runOnce(new Date(Date.parse(batch!.sendAt) + 1000))
    expect(summary).toMatchObject({ due: 1, skipped: 1, sent: 0, notifications: 1 })
    expect(received(f, SUBSCRIBER_A)[0]?.emailState).toBe('skipped')
    expect(f.notifications.batches()[0]).toMatchObject({ status: 'failed', error: 'outbound-disabled' })
  })

  test('coalesces a window and sends it once a transport is configured', async () => {
    const sent: Array<{ principalId: string; notificationIds: readonly string[] }> = []
    const transport: NotificationEmailTransport = {
      async send(message) { sent.push({ principalId: message.principalId, notificationIds: message.notificationIds }) },
    }
    const f = await setup({ outboundEmail: true, transport })
    expect(f.notify.service.worker.outboundConfigured()).toBe(true)
    await f.post(envelope('comments.create', { subscriberIds: [SUBSCRIBER_A] }))
    await f.relay.idle()
    await f.post(envelope('comments.create', { subscriberIds: [SUBSCRIBER_A] }))
    await f.relay.idle()
    expect(f.notifications.batches()).toHaveLength(1)
    expect(received(f, SUBSCRIBER_A).map(row => row.emailState)).toEqual(['held', 'held'])

    const [batch] = f.notifications.batches()
    const summary = await f.notify.service.worker.runOnce(new Date(Date.parse(batch!.sendAt) + 1000))
    expect(summary).toMatchObject({ due: 1, sent: 1, notifications: 2 })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.principalId).toBe(SUBSCRIBER_A)
    expect(sent[0]?.notificationIds).toHaveLength(2)
    expect(received(f, SUBSCRIBER_A).map(row => row.emailState)).toEqual(['sent', 'sent'])
    expect(f.notifications.batches()[0]).toMatchObject({ status: 'sent' })
  })

  test('keeps a failed send pending for the next run', async () => {
    const sent: string[][] = []
    const transport: NotificationEmailTransport = {
      async send(message) { sent.push([...message.notificationIds]); throw new Error('smtp is down') },
    }
    const f = await setup({ outboundEmail: true, transport })
    await f.post(envelope('comments.create', { subscriberIds: [SUBSCRIBER_A] }))
    await f.relay.idle()
    const [batch] = f.notifications.batches()
    const at = new Date(Date.parse(batch!.sendAt) + 1000)

    const first = await f.notify.service.worker.runOnce(at)
    expect(first).toMatchObject({ due: 1, failed: 1, sent: 0 })
    expect(received(f, SUBSCRIBER_A)[0]?.emailState).toBe('held')
    expect(f.notifications.batches()[0]).toMatchObject({ status: 'pending', error: 'smtp is down' })

    // The second run picks the very same batch up again and retries the send.
    const second = await f.notify.service.worker.runOnce(at)
    expect(second).toMatchObject({ due: 1, failed: 1, sent: 0 })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(received(f, SUBSCRIBER_A)[0]?.emailState).toBe('held')
    expect(f.notifications.batches()[0]).toMatchObject({ status: 'pending', error: 'smtp is down' })
  })
})