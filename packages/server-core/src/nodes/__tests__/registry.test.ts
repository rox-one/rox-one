import { describe, expect, it } from 'bun:test'
import { NodeRegistry } from '../registry.ts'

/** Deterministic clock + inert timers so TTL/timeout behavior is exercised by sweep. */
function fixture(options: { presenceTtlMs?: number; maxPendingPerNode?: number; invokeTimeoutMs?: number } = {}) {
  let now = 1_000
  const registry = new NodeRegistry({
    presenceTtlMs: options.presenceTtlMs ?? 100,
    maxPendingPerNode: options.maxPendingPerNode ?? 2,
    invokeTimeoutMs: options.invokeTimeoutMs ?? 50,
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
  })
  return { registry, advance: (ms: number) => { now += ms }, at: () => now }
}

describe('NodeRegistry — claims are not authority', () => {
  it('refuses a command the node merely claims but the server has not allowlisted', async () => {
    const { registry } = fixture()
    registry.registerNode({ nodeId: 'mac-1', declaredCaps: ['system.run'], declaredCommands: ['system.run'] })

    // No server allowlist — the declaration cannot widen the node's authority.
    expect(registry.isCommandAuthorized('mac-1', 'system.run')).toBe(false)

    const dispatch = registry.invoke('mac-1', 'system.run')
    expect(dispatch.accepted).toBe(false)
    expect(dispatch.invokeId).toBeNull()
    expect(registry.pendingCountFor('mac-1')).toBe(0)
    const result = await dispatch.result
    expect(result).toMatchObject({ status: 'error', error: { code: 'NOT_ALLOWLISTED' } })
  })

  it('dispatches once the server allowlists the command (green after the refusal)', async () => {
    const { registry } = fixture()
    registry.registerNode({ nodeId: 'mac-1', declaredCaps: ['system.run'], declaredCommands: ['system.run'] })

    expect(registry.isCommandAuthorized('mac-1', 'system.run')).toBe(false)
    registry.setAllowlist('mac-1', { caps: ['system.run'], commands: ['system.run'] })
    expect(registry.isCommandAuthorized('mac-1', 'system.run')).toBe(true)

    const dispatch = registry.invoke('mac-1', 'system.run')
    expect(dispatch.accepted).toBe(true)
    expect(registry.pendingCountFor('mac-1')).toBe(1)
    expect(registry.settleInvoke(dispatch.invokeId!, { exitCode: 0 })).toBe(true)
    expect(await dispatch.result).toMatchObject({ status: 'ok', payload: { exitCode: 0 } })
  })

  it('refuses an allowlisted command the node never declared', async () => {
    const { registry } = fixture()
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['system.run'] })
    registry.setAllowlist('mac-1', { commands: ['system.run', 'system.reboot'] })

    const dispatch = registry.invoke('mac-1', 'system.reboot')
    expect(dispatch.accepted).toBe(false)
    expect(await dispatch.result).toMatchObject({ status: 'error', error: { code: 'NOT_DECLARED' } })
  })

  it('refuses an unknown node', async () => {
    const { registry } = fixture()
    registry.setDefaultAllowlist({ commands: ['system.run'] })
    const dispatch = registry.invoke('ghost', 'system.run')
    expect(dispatch.accepted).toBe(false)
    expect(await dispatch.result).toMatchObject({ status: 'error', error: { code: 'NODE_UNKNOWN' } })
  })

  it('falls back to the default allowlist when a node has none', () => {
    const { registry } = fixture()
    registry.setDefaultAllowlist({ commands: ['ping'] })
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['ping'] })
    expect(registry.isCommandAuthorized('mac-1', 'ping')).toBe(true)

    // A node-specific allowlist overrides the default entirely.
    registry.setAllowlist('mac-1', { commands: [] })
    expect(registry.isCommandAuthorized('mac-1', 'ping')).toBe(false)
  })
})

describe('NodeRegistry — presence TTL', () => {
  it('expires presence after the TTL and reports the node offline', () => {
    const { registry, advance } = fixture({ presenceTtlMs: 100 })
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['ping'] })

    expect(registry.presenceStatus('mac-1')?.online).toBe(true)
    expect(registry.listNodes()[0]?.online).toBe(true)

    advance(100)
    // Boundary: exactly at the TTL the heartbeat is still live.
    expect(registry.presenceStatus('mac-1')?.online).toBe(true)

    advance(1)
    expect(registry.presenceStatus('mac-1')?.online).toBe(false)
    expect(registry.listNodes()[0]?.online).toBe(false)
  })

  it('sweeps expired presence and fails that node’s in-flight invokes', async () => {
    const { registry, advance } = fixture({ presenceTtlMs: 100 })
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['ping'] })
    registry.setAllowlist('mac-1', { commands: ['ping'] })

    const dispatch = registry.invoke('mac-1', 'ping')
    expect(dispatch.accepted).toBe(true)

    advance(101)
    const swept = registry.sweep()
    expect(swept.expired).toEqual(['mac-1'])
    expect(swept.failedInvokes).toBe(1)
    expect(registry.presenceStatus('mac-1')).toBeNull()
    expect(await dispatch.result).toMatchObject({ status: 'error', error: { code: 'DISCONNECTED' } })

    // Second sweep is a no-op — the entry is already gone.
    expect(registry.sweep()).toEqual({ expired: [], failedInvokes: 0 })
  })

  it('revives a node on re-registration (heartbeat within TTL)', () => {
    const { registry, advance } = fixture({ presenceTtlMs: 100 })
    registry.registerNode({ nodeId: 'mac-1' })
    advance(150)
    expect(registry.presenceStatus('mac-1')?.online).toBe(false)
    registry.registerNode({ nodeId: 'mac-1' })
    expect(registry.presenceStatus('mac-1')?.online).toBe(true)
  })
})

describe('NodeRegistry — bounded pending invokes', () => {
  it('enforces the per-node bound and frees a slot after settlement', async () => {
    const { registry } = fixture({ maxPendingPerNode: 2 })
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['ping'] })
    registry.setAllowlist('mac-1', { commands: ['ping'] })

    const a = registry.invoke('mac-1', 'ping')
    const b = registry.invoke('mac-1', 'ping')
    expect(a.accepted).toBe(true)
    expect(b.accepted).toBe(true)
    expect(registry.pendingCountFor('mac-1')).toBe(2)

    const c = registry.invoke('mac-1', 'ping')
    expect(c.accepted).toBe(false)
    expect(c.invokeId).toBeNull()
    expect(await c.result).toMatchObject({ status: 'error', error: { code: 'QUEUE_FULL' } })
    expect(registry.pendingCountFor('mac-1')).toBe(2)

    expect(registry.settleInvoke(a.invokeId!, null)).toBe(true)
    expect(registry.pendingCountFor('mac-1')).toBe(1)
    const d = registry.invoke('mac-1', 'ping')
    expect(d.accepted).toBe(true)
  })

  it('unregister fails in-flight invokes with DISCONNECTED', async () => {
    const { registry } = fixture()
    registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['ping'] })
    registry.setAllowlist('mac-1', { commands: ['ping'] })
    const dispatch = registry.invoke('mac-1', 'ping')

    expect(registry.unregisterNode('mac-1')).toBe(true)
    expect(await dispatch.result).toMatchObject({ status: 'error', error: { code: 'DISCONNECTED' } })
    expect(registry.getNode('mac-1')).toBeNull()
    expect(registry.unregisterNode('mac-1')).toBe(false)
  })
})