/**
 * SessionEventBus unit tests (PRD §8 "Lifecycle hooks" / §32).
 *
 * Locks the bus semantics consumers rely on: per-type delivery, disposer/off
 * unsubscribe, listener-throw isolation (fail-soft), listener counting, the
 * inert default bus, and the one seam that is cheap to drive without full
 * workspace wiring (`SessionManager.notifySessionCreated`).
 */

import { describe, expect, it } from 'bun:test'
import { NOOP_SESSION_EVENT_BUS, SessionEventBus, summarizeToolArgs } from '../SessionEventBus'
import { SessionManager } from '../SessionManager'

const envelope = { sessionId: 's1', workspaceId: 'w1', ts: '2026-10-08T00:00:00.000Z' } as const

describe('SessionEventBus', () => {
  it('delivers events only to listeners of that type', () => {
    const bus = new SessionEventBus()
    const seen: string[] = []
    bus.on('tool.call', (evt) => seen.push(`call:${evt.tool}:${evt.callId}`))
    bus.on('tool.result', (evt) => seen.push(`result:${evt.ok}`))

    bus.emit('tool.call', { ...envelope, tool: 'Bash', callId: 'tu-1', argsSummary: 'command=ls' })
    bus.emit('tool.result', { ...envelope, tool: 'Bash', callId: 'tu-1', ok: false, error: 'boom' })

    expect(seen).toEqual(['call:Bash:tu-1', 'result:false'])
  })

  it('unsubscribes via the returned disposer and via off()', () => {
    const bus = new SessionEventBus()
    const seen: string[] = []
    const off = bus.on('session.created', (evt) => seen.push(evt.sessionId))
    expect(bus.listenerCount('session.created')).toBe(1)

    off()
    off() // idempotent
    bus.emit('session.created', { ...envelope, reason: 'create' })
    expect(seen).toEqual([])
    expect(bus.listenerCount('session.created')).toBe(0)

    const listener = () => seen.push('second')
    bus.on('session.created', listener)
    bus.off('session.created', listener)
    bus.emit('session.created', { ...envelope, reason: 'create' })
    expect(seen).toEqual([])
  })

  it('isolates a throwing listener from other listeners and from the emitter', () => {
    const bus = new SessionEventBus()
    const seen: string[] = []
    bus.on('session.created', () => {
      throw new Error('listener boom')
    })
    bus.on('session.created', (evt) => seen.push(evt.reason))

    expect(() => bus.emit('session.created', { ...envelope, reason: 'create' })).not.toThrow()
    expect(seen).toEqual(['create'])
    expect(bus.listenerCount('session.created')).toBe(2)
  })

  it('keeps delivering when a listener unsubscribes itself during emit', () => {
    const bus = new SessionEventBus()
    const seen: string[] = []
    const off = bus.on('session.created', () => {
      seen.push('first')
      off()
    })
    bus.on('session.created', () => seen.push('second'))

    bus.emit('session.created', { ...envelope, reason: 'create' })
    expect(seen).toEqual(['first', 'second'])
    expect(bus.listenerCount('session.created')).toBe(1)
  })

  it('counts listeners per type and ignores removals that were never registered', () => {
    const bus = new SessionEventBus()
    const listener = () => {}
    expect(bus.listenerCount('session.completed')).toBe(0)

    bus.on('session.completed', listener)
    bus.on('session.completed', listener) // Set dedupes identical listeners
    expect(bus.listenerCount('session.completed')).toBe(1)

    bus.off('session.completed', () => {}) // not registered: no-op
    bus.off('session.branched', listener) // no listeners for that type: no-op
    expect(bus.listenerCount('session.completed')).toBe(1)

    bus.off('session.completed', listener)
    expect(bus.listenerCount('session.completed')).toBe(0)
  })

  it('exposes an inert default bus', () => {
    expect(NOOP_SESSION_EVENT_BUS.listenerCount('session.created')).toBe(0)
    expect(NOOP_SESSION_EVENT_BUS.listenerCount('workspace.idle')).toBe(0)
    expect(() => NOOP_SESSION_EVENT_BUS.emit('workspace.idle', envelope)).not.toThrow()
  })
})

describe('SessionManager lifecycle publish', () => {
  it('publishes session.created with reason create on a wired bus', () => {
    const sm = new SessionManager()
    const bus = new SessionEventBus()
    const events: Array<{ sessionId: string; workspaceId: string; ts: string; reason: string }> = []
    bus.on('session.created', (evt) => events.push(evt))
    sm.setSessionEventBus(bus)

    sm.notifySessionCreated('ws-1', 'sess-1')

    expect(events).toHaveLength(1)
    expect(events[0]!.sessionId).toBe('sess-1')
    expect(events[0]!.workspaceId).toBe('ws-1')
    expect(events[0]!.reason).toBe('create')
    expect(new Date(events[0]!.ts).toISOString()).toBe(events[0]!.ts)
  })

  it('forwards the branch/import reason to the created event', () => {
    const sm = new SessionManager()
    const bus = new SessionEventBus()
    const reasons: string[] = []
    bus.on('session.created', (evt) => reasons.push(evt.reason))
    sm.setSessionEventBus(bus)

    sm.notifySessionCreated('ws-1', 'sess-2', 'branch')
    sm.notifySessionCreated('ws-1', 'sess-3', 'import')

    expect(reasons).toEqual(['branch', 'import'])
  })

  it('stays silent and safe on the default bus, and can be detached again', () => {
    const sm = new SessionManager()
    expect(() => sm.notifySessionCreated('ws-1', 'sess-4')).not.toThrow()

    const bus = new SessionEventBus()
    let count = 0
    bus.on('session.created', () => count++)
    sm.setSessionEventBus(bus)
    sm.setSessionEventBus(null)
    sm.notifySessionCreated('ws-1', 'sess-5')

    expect(count).toBe(0)
    expect(bus.listenerCount('session.created')).toBe(1)
  })
})

describe('summarizeToolArgs', () => {
  it('digests scalars and collapses nested payloads', () => {
    expect(summarizeToolArgs({ path: 'src/a.ts', n: 3, flag: true })).toBe('path=src/a.ts, n=3, flag=true')
    expect(summarizeToolArgs({ paths: ['a', 'b'] })).toBe('paths=[2 items]')
    expect(summarizeToolArgs({ opts: { deep: true } })).toBe('opts={…}')
    expect(summarizeToolArgs({ content: 'x'.repeat(500) })).toBe(`content=${'x'.repeat(64)}…`)
    expect(summarizeToolArgs({ empty: null, missing: undefined })).toBeUndefined()
    expect(summarizeToolArgs(null)).toBeUndefined()
    expect(summarizeToolArgs('plain string')).toBeUndefined()
    expect(summarizeToolArgs(['a'])).toBeUndefined()
  })

  it('clips the digest to the requested length', () => {
    const summary = summarizeToolArgs({ a: 'x'.repeat(20), b: 'y'.repeat(20), c: 'z'.repeat(20) }, 30)
    expect(summary!.endsWith('…')).toBe(true)
    expect(summary).not.toContain('b=')
  })
})