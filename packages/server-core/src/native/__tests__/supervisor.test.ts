import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'bun:test'
import { NativeSupervisor } from '../supervisor.ts'
import type { NativeSidecarClient } from '../client.ts'

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

describe('NativeSupervisor', () => {
  it('does not spawn when the native sidecar flag is off', async () => {
    let spawned = 0
    const supervisor = new NativeSupervisor({
      enabled: false,
      resolveBin: () => '/tmp/craft-native-missing',
      spawn: () => {
        spawned++
        throw new Error('should not spawn')
      },
      logger: silentLogger(),
    })
    await supervisor.start()
    expect(spawned).toBe(0)
    expect(supervisor.getClient()).toBeNull()
    expect(supervisor.isDisabled()).toBe(false)
    await supervisor.stop()
  })

  it('disables after maxCrashes consecutive spawn/connect failures', async () => {
    let spawned = 0
    const supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => '/tmp/fake-craft-native',
      maxCrashes: 3,
      backoffMs: 1,
      connectTimeoutMs: 20,
      spawn: () => {
        spawned++
        const child = new EventEmitter() as EventEmitter & {
          pid: number
          killed: boolean
          kill: (signal?: string) => boolean
        }
        child.pid = 4000 + spawned
        child.killed = false
        child.kill = () => {
          child.killed = true
          queueMicrotask(() => child.emit('exit', 1, null))
          return true
        }
        queueMicrotask(() => child.emit('exit', 1, null))
        return child
      },
      connect: async () => {
        throw new Error('connect refused')
      },
      logger: silentLogger(),
    })
    await supervisor.start()
    const deadline = Date.now() + 2000
    while (!supervisor.isDisabled() && Date.now() < deadline) {
      await Bun.sleep(10)
    }
    expect(supervisor.isDisabled()).toBe(true)
    expect(spawned).toBe(3)
    expect(supervisor.getClient()).toBeNull()
    await supervisor.stop()
  })

  it('exposes a connected client after a successful handshake', async () => {
    const fake: NativeSidecarClient = {
      registeredChannels: ['native:health'],
      invoke: async <T,>() => ({ ok: true }) as T,
      close: async () => {},
    }
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      killed: boolean
      kill: (signal?: string) => boolean
    }
    child.pid = 7
    child.killed = false
    child.kill = () => {
      child.killed = true
      return true
    }
    const supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => '/tmp/fake-craft-native',
      spawn: () => child,
      connect: async () => fake,
      logger: silentLogger(),
    })
    await supervisor.start()
    expect(supervisor.getClient()).toBe(fake)
    expect(supervisor.isDisabled()).toBe(false)
    await supervisor.stop()
    expect(child.killed).toBe(true)
  })
})
