import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandRejection, type Authorizer } from '@rox/core/commands'
import { CommandExecutor } from '../executor'
import { InProcessEventBus } from '../event-bus'
import { InMemoryCommandStore } from '../store'
import { SqliteCommandStore } from '../local-store'
import { ACTOR, WS, envelope, testRegistry } from './helpers'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function setup(options: { authority?: 'local' | 'workspace'; authorizer?: Authorizer; enabled?: () => boolean; flags?: Set<string> } = {}) {
  const { registry, state, flags } = testRegistry({ flags: options.flags })
  const store = new InMemoryCommandStore()
  const bus = new InProcessEventBus({ epoch: 'e1' })
  const frames: unknown[] = []
  bus.subscribe((ws, frame) => frames.push({ ws, frame }))
  const executor = new CommandExecutor({
    registry,
    store,
    authority: options.authority ?? 'local',
    publish: events => { bus.publish(events) },
    ...(options.authorizer ? { authorizer: options.authorizer } : {}),
    ...(options.enabled ? { isEnabled: options.enabled } : {}),
  })
  const run = (env: unknown, actor = ACTOR) => executor.execute({ workspaceId: WS, actor, envelope: env })
  return { executor, store, bus, frames, state, flags, registry, run }
}

describe('system.ping', () => {
  test('applied receipt + system.pinged event + push to user:{actor}', async () => {
    const f = setup()
    const receipt = await f.run(envelope('system.ping', { nonce: 'abc' }, { commandId: 'ping-1' }))
    expect(receipt).toMatchObject({ commandId: 'ping-1', status: 'applied', result: { pong: true, nonce: 'abc', authority: 'local' } })
    expect(receipt.eventIds).toHaveLength(1)
    const events = await f.store.listEvents(WS)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'system.pinged', actorId: 'user-1', causationId: 'ping-1', correlationId: 'ping-1', payload: { nonce: 'abc' } })
    expect(f.frames).toEqual([{ ws: WS, frame: expect.objectContaining({ frame: 'event', topic: 'user:user-1', type: 'system.pinged', seq: 1, epoch: 'e1', payload: { commandId: 'ping-1', nonce: 'abc' }, eventId: receipt.eventIds![0] }) }])
  })
})

describe('idempotency', () => {
  test('same commandId twice → one effect, second answer is duplicate with the original', async () => {
    const f = setup()
    const env = envelope('test.increment', { by: 2 }, { commandId: 'c-1' })
    const first = await f.run(env)
    const second = await f.run(env)
    expect(first.status).toBe('applied')
    expect(second).toMatchObject({ commandId: 'c-1', status: 'duplicate', original: first, revision: 1 })
    expect(f.state).toMatchObject({ value: 2, calls: 1 })
    expect(f.store.counts()).toEqual({ receipts: 1, events: 1 })
    expect(f.frames).toHaveLength(1)
  })

  test('same idempotencyKey with a new commandId is also a duplicate', async () => {
    const f = setup()
    await f.run(envelope('test.increment', {}, { commandId: 'a', idempotencyKey: 'k' }))
    const again = await f.run(envelope('test.increment', {}, { commandId: 'b', idempotencyKey: 'k' }))
    expect(again.status).toBe('duplicate')
    expect(f.state.calls).toBe(1)
  })

  test('reusing a key for a different request or another actor is rejected, not applied', async () => {
    const f = setup()
    await f.run(envelope('test.increment', { by: 1 }, { commandId: 'c' }))
    expect(await f.run(envelope('test.increment', { by: 5 }, { commandId: 'c' }))).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(await f.run(envelope('test.increment', { by: 1 }, { commandId: 'c' }), { principalId: 'intruder', kind: 'user' })).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(f.state.calls).toBe(1)
  })

  test('50 concurrent submissions of one command → exactly one effect', async () => {
    const f = setup()
    const env = envelope('test.increment', {}, { commandId: 'race' })
    const receipts = await Promise.all(Array.from({ length: 50 }, () => f.run(env)))
    expect(receipts.filter(r => r.status === 'applied')).toHaveLength(1)
    expect(receipts.filter(r => r.status === 'duplicate')).toHaveLength(49)
    expect(f.state.calls).toBe(1)
    expect(f.store.counts()).toEqual({ receipts: 1, events: 1 })
  })
})

describe('negative paths', () => {
  test('VALIDATION: malformed envelope and invalid payload', async () => {
    const f = setup()
    expect(await f.run({ type: 'system.ping' })).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await f.run(envelope('system.ping', { nonce: 7 }, { commandId: 'v' }))).toMatchObject({ commandId: 'v', status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await f.run(envelope('system.ping', { extra: true }))).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await f.run(envelope('test.increment', [1, 2]))).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test('UNKNOWN_COMMAND', async () => {
    const f = setup()
    expect(await f.run(envelope('nope.nothing', {}))).toMatchObject({ status: 'rejected', error: { code: 'UNKNOWN_COMMAND' } })
  })

  test('NOT_BOUND for a defined command without a handler; UNAVAILABLE while its module flag is off', async () => {
    const f = setup()
    expect(await f.run(envelope('test.unbound', {}))).toMatchObject({ status: 'rejected', error: { code: 'NOT_BOUND' } })
    // Catalogue command of a flagged module: flag off → UNAVAILABLE; flag on but unbound → NOT_BOUND.
    const flagged = f.registry.list().find(def => def.type === 'tasks.update_status')!
    expect(flagged.flag).toBeDefined()
    expect(await f.run(envelope('tasks.update_status', {}))).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    f.flags.add(flagged.flag!)
    // tasks.update_status is by-target; the local executor can run it once bound.
    expect(await f.run(envelope('tasks.update_status', {}))).toMatchObject({ status: 'rejected', error: { code: 'NOT_BOUND' } })
  })

  test('FORBIDDEN via the Authorizer port (fail-closed on throw)', async () => {
    const denied = setup({ authorizer: { can: async (_p, action, ref) => !(action === 'write' && ref?.id === 'secret') } })
    expect(await denied.run(envelope('test.increment', {}, { target: { kind: 'task', id: 'secret' } }))).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(denied.state.calls).toBe(0)
    const throwing = setup({ authorizer: { can: async () => { throw new Error('acl down') } } })
    expect(await throwing.run(envelope('system.ping', {}))).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    const seen: unknown[] = []
    const capture = setup({ authorizer: { can: async (principal, action, ref) => { seen.push({ principal, action, ref }); return true } } })
    await capture.run(envelope('system.ping', {}, { onBehalfOf: 'bot-1' }))
    expect(seen).toEqual([{ principal: { principalId: 'user-1', kind: 'user', onBehalfOf: 'bot-1', workspaceId: WS }, action: 'read', ref: null }])
  })

  test('expectedRevision conflict → conflict receipt, nothing committed, retry allowed', async () => {
    const f = setup()
    await f.run(envelope('test.increment', {}))
    const conflict = await f.run(envelope('test.increment', {}, { commandId: 'stale', expectedRevision: 0 }))
    expect(conflict).toEqual({ commandId: 'stale', status: 'conflict', conflict: { currentRevision: 1, current: { value: 1 } } })
    expect(f.store.counts()).toEqual({ receipts: 1, events: 1 })
    // conflict receipts are not stored: the same id may be retried with the right revision.
    const retried = await f.run(envelope('test.increment', {}, { commandId: 'stale', expectedRevision: 1 }))
    expect(retried.status).toBe('applied')
  })

  test('PAYLOAD_TOO_LARGE uses the definition budget', async () => {
    const f = setup()
    const receipt = await f.run(envelope('system.ping', { nonce: 'x'.repeat(2000) }))
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'PAYLOAD_TOO_LARGE', details: { limit: 1024 } } })
    expect(await f.run(envelope('test.increment', { blob: 'x'.repeat(70 * 1024) }))).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await f.run(envelope('test.increment', { blob: 'x'.repeat(2 * 1024 * 1024) }))).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  test('authority mismatch: LOCAL_ONLY on the workspace, SERVER_REQUIRED locally', async () => {
    const server = setup({ authority: 'workspace' })
    const localOnly = server.registry.list().find(def => def.authority === 'local' && def.module !== 'test')!
    expect(await server.run(envelope(localOnly.type, {}))).toMatchObject({ error: { code: 'LOCAL_ONLY' } })
    const local = setup()
    expect(await local.run(envelope('test.remote_increment', {}))).toMatchObject({ error: { code: 'SERVER_REQUIRED' } })
    expect(local.state.calls).toBe(0)
  })

  test('disabled bus and unauthenticated actor', async () => {
    const off = setup({ enabled: () => false })
    expect(await off.run(envelope('system.ping', {}, { commandId: 'x' }))).toMatchObject({ commandId: 'x', status: 'rejected', error: { code: 'UNAVAILABLE' } })
    const f = setup()
    expect(await f.run(envelope('system.ping', {}), { principalId: '', kind: 'user' })).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('handler crash → INTERNAL, rollback; CommandRejection keeps its code', async () => {
    const f = setup()
    expect(await f.run(envelope('test.increment', { fail: true }))).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    expect(f.store.counts()).toEqual({ receipts: 0, events: 0 })
    f.registry.define({ type: 'test.reject', module: 'test', authority: 'local', verb: 'write', schema: { safeParse: v => ({ success: true, data: v }) }, schemaBound: true })
    f.registry.bind('test.reject', () => { throw new CommandRejection('NOT_FOUND', 'gone') })
    expect(await f.run(envelope('test.reject', {}))).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND', message: 'gone' } })
  })

  test('middleware hook runs after authorize and may short-circuit', async () => {
    const f = setup()
    const order: string[] = []
    f.executor.use({ name: 'policy', run: async (ctx, next) => {
      order.push(`policy:${ctx.definition.type}`)
      if (ctx.envelope.type === 'test.increment') return { commandId: ctx.envelope.commandId, status: 'rejected', error: { code: 'FORBIDDEN', message: 'policy' } }
      return next()
    } })
    expect(await f.run(envelope('test.increment', {}))).toMatchObject({ error: { code: 'FORBIDDEN', message: 'policy' } })
    expect((await f.run(envelope('system.ping', {}))).status).toBe('applied')
    expect(f.executor.middlewareNames()).toEqual(['policy'])
    expect(order).toEqual(['policy:test.increment', 'policy:system.ping'])
    expect(f.state.calls).toBe(0)
  })

  test('publish failure never changes the receipt', async () => {
    const { registry } = testRegistry()
    const store = new InMemoryCommandStore()
    const errors: unknown[] = []
    const executor = new CommandExecutor({ registry, store, authority: 'local', publish: () => { throw new Error('valkey down') }, onPublishError: e => errors.push(e) })
    const receipt = await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: envelope('system.ping', {}) })
    expect(receipt.status).toBe('applied')
    expect(errors).toHaveLength(1)
    expect(await store.listEvents(WS)).toHaveLength(1)
  })
})

describe('SqliteCommandStore', () => {
  test('private files, durable receipts across reopen, rollback on conflict', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-cmd-store-'))
    roots.push(root)
    const { registry, state } = testRegistry()
    let store = new SqliteCommandStore({ workspaceRoot: root })
    expect(statSync(join(root, '.rox')).mode & 0o777).toBe(0o700)
    expect(statSync(store.dbPath).mode & 0o777).toBe(0o600)
    let executor = new CommandExecutor({ registry, store, authority: 'local' })
    const env = envelope('test.increment', {}, { commandId: 'durable' })
    expect((await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: env })).status).toBe('applied')
    expect((await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: envelope('test.increment', {}, { expectedRevision: 0 }) })).status).toBe('conflict')
    store.close()
    store = new SqliteCommandStore({ workspaceRoot: root })
    executor = new CommandExecutor({ registry, store, authority: 'local' })
    const replay = await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: env })
    expect(replay).toMatchObject({ status: 'duplicate', original: { commandId: 'durable', status: 'applied' } })
    expect(state.calls).toBe(2)
    const events = await store.listEvents(WS)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ sequence: 1, type: 'task.task_status_change', subject: { kind: 'task', id: 'counter' }, aggregateRevision: 1 })
    const parallel = await Promise.all(Array.from({ length: 10 }, () => executor.execute({ workspaceId: WS, actor: ACTOR, envelope: envelope('test.increment', {}, { commandId: 'p' }) })))
    expect(parallel.filter(r => r.status === 'applied')).toHaveLength(1)
    store.close()
  })
})
