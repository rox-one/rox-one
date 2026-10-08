import { describe, expect, test } from 'bun:test'
import type { CommandEnvelope } from '@rox/core/commands'
import { CommandExecutor } from '../executor'
import { CommandRouter } from '../router'
import { InMemoryCommandStore } from '../store'
import { ACTOR, WS, envelope, testRegistry } from './helpers'

function setup(options: { sink?: boolean; enabled?: boolean; targetAuthority?: 'local' | 'workspace' } = {}) {
  const { registry, state } = testRegistry()
  const local = new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'local' })
  const queued: CommandEnvelope[] = []
  const router = new CommandRouter({
    registry,
    local,
    isEnabled: () => options.enabled !== false,
    workspaceSink: () => options.sink === false ? null : {
      enqueue: async (_ws, env) => { queued.push(env); return { commandId: env.commandId, status: 'queued', queuedAt: 'now' } },
    },
    resolveTargetAuthority: (_ws, ref) => ref.id.startsWith('shared-') ? 'workspace' : options.targetAuthority,
  })
  const route = (env: unknown) => router.route({ workspaceId: WS, actor: ACTOR, envelope: env })
  return { router, route, queued, state }
}

describe('CommandRouter', () => {
  test('local authority → local executor', async () => {
    const f = setup()
    expect((await f.route(envelope('test.increment', {}))).status).toBe('applied')
    expect(f.queued).toHaveLength(0)
  })

  test('workspace authority → outbox (queued), never executed locally', async () => {
    const f = setup()
    const receipt = await f.route(envelope('test.remote_increment', {}, { commandId: 'r1' }))
    expect(receipt).toEqual({ commandId: 'r1', status: 'queued', queuedAt: 'now' })
    expect(f.queued.map(e => e.commandId)).toEqual(['r1'])
    expect(f.state.calls).toBe(0)
  })

  test('workspace authority without a workspace connection → SERVER_REQUIRED', async () => {
    const f = setup({ sink: false })
    expect(await f.route(envelope('test.remote_increment', {}))).toMatchObject({ status: 'rejected', error: { code: 'SERVER_REQUIRED' } })
  })

  test('by-target: target authority, then authorityHint, then local', async () => {
    const f = setup()
    expect((await f.route(envelope('system.ping', {}, { target: { kind: 'task', id: 'shared-1' } }))).status).toBe('queued')
    expect((await f.route(envelope('system.ping', {}, { authorityHint: 'workspace' }))).status).toBe('queued')
    expect((await f.route(envelope('system.ping', {}, { target: { kind: 'task', id: 'mine' } }))).status).toBe('applied')
    expect((await f.route(envelope('system.ping', {}))).status).toBe('applied')
    expect(f.router.resolveAuthority(WS, envelope('system.ping', {}) as CommandEnvelope)).toBe('local')
  })

  test('client-side checks before queueing: size and bound schema', async () => {
    const f = setup()
    expect(await f.route(envelope('system.ping', { nonce: 'x'.repeat(2000) }, { authorityHint: 'workspace' }))).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await f.route(envelope('system.ping', { bogus: 1 }, { authorityHint: 'workspace' }))).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(f.queued).toHaveLength(0)
  })

  test('invalid / unknown envelopes and a disabled bus', async () => {
    const f = setup()
    expect(await f.route({})).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await f.route(envelope('ghost.cmd', {}))).toMatchObject({ error: { code: 'UNKNOWN_COMMAND' } })
    const off = setup({ enabled: false })
    expect(await off.route(envelope('system.ping', {}, { commandId: 'z' }))).toMatchObject({ commandId: 'z', error: { code: 'UNAVAILABLE' } })
  })
})
