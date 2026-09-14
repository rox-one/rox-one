import { describe, expect, it, mock } from 'bun:test'
import { createNativeSurfaceLifetime, createNativeSurfaceOwners } from '../native-surface-owners'
import type { NativeBoundsRect } from '../native-surface-visibility'

const left = { x: 40, y: 50, width: 400, height: 300 }
const right = { x: 500, y: 50, width: 400, height: 300 }

describe('native surface owner cleanup', () => {
  it('hides only the released inspector instance, preserving sibling native panels', async () => {
    const calls: Array<[string, NativeBoundsRect | null]> = []
    const sync = async (id: string, rect: NativeBoundsRect | null) => { calls.push([id, rect]) }
    const owners = createNativeSurfaceOwners()
    const inspector = owners.acquire('inspector', sync)
    const sibling = owners.acquire('sibling', sync)
    inspector.update(left)
    sibling.update(right)
    await inspector.release()
    expect(calls).toEqual([['inspector', left], ['sibling', right], ['inspector', null]])
    sibling.update(right)
    expect(calls).toHaveLength(3)
  })

  it('a hidden or released durable owner cannot hide its visible sibling', async () => {
    const sync = mock(async (_id: string, _rect: NativeBoundsRect | null) => {})
    const owners = createNativeSurfaceOwners()
    const first = owners.acquire('shared', sync)
    const second = owners.acquire('shared', sync)
    first.update(left)
    second.update(null)
    second.release()
    await owners.hideUnowned('shared', sync)
    expect(sync.mock.calls).toEqual([['shared', left]])
    await first.release()
    expect(sync.mock.calls.at(-1)).toEqual(['shared', null])
  })

  it('transfers to the most recently revealed owner and ignores late released updates', async () => {
    const sync = mock(async (_id: string, _rect: NativeBoundsRect | null) => {})
    const owners = createNativeSurfaceOwners()
    const old = owners.acquire('shared', sync)
    const next = owners.acquire('shared', sync)
    old.update(left)
    next.update(right)
    old.update(null)
    old.release()
    old.update(left)
    await owners.whenSettled('shared')
    expect(sync.mock.calls).toEqual([['shared', left], ['shared', right]])
    await next.release()
    expect(sync.mock.calls.at(-1)).toEqual(['shared', null])
  })

  it('releases an async attachment that arrives after inspector close without adopting it', () => {
    const hide = mock((_id: string) => {})
    const lifetime = createNativeSurfaceLifetime(hide)
    lifetime.release()
    expect(lifetime.claim('late-inspector')).toBe(false)
    expect(hide.mock.calls).toEqual([['late-inspector']])
  })

  it('releases each owned attachment once and never enumerates other instances', () => {
    const hide = mock((_id: string) => {})
    const lifetime = createNativeSurfaceLifetime(hide)
    expect(lifetime.claim('first')).toBe(true)
    expect(lifetime.claim('next')).toBe(true)
    lifetime.release()
    lifetime.release()
    expect(hide.mock.calls).toEqual([['first'], ['next']])
  })

  it('serializes a deferred update before the latest final hide', async () => {
    let finishFirst!: () => void
    let finishHide!: () => void
    let hideStarted!: () => void
    const first = new Promise<void>(resolve => { finishFirst = resolve })
    const hidden = new Promise<void>(resolve => { finishHide = resolve })
    const started = new Promise<void>(resolve => { hideStarted = resolve })
    const calls: Array<NativeBoundsRect | null> = []
    const owners = createNativeSurfaceOwners()
    const owner = owners.acquire('shared', async (_id, rect) => {
      calls.push(rect)
      if (rect) return first
      hideStarted()
      return hidden
    })
    owner.update(left)
    owner.update(right)
    const released = owner.release()
    expect(calls).toEqual([left])
    finishFirst()
    await started
    // Intermediate B is coalesced; an old A cannot apply after this null.
    expect(calls).toEqual([left, null])
    finishHide()
    await released
    await owners.whenSettled('shared')
    expect(calls.at(-1)).toBeNull()
  })

  it('retries a rejected rect on the next invalidation without polling', async () => {
    let rejectFirst!: (reason?: unknown) => void
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    let attempts = 0
    const sync = mock(async (_id: string, _rect: NativeBoundsRect | null) => {
      attempts++
      if (attempts === 1) return first
    })
    const owners = createNativeSurfaceOwners()
    const owner = owners.acquire('retry', sync)
    owner.update(left)
    rejectFirst(new Error('Disconnected'))
    await owners.whenSettled('retry')
    expect(attempts).toBe(1)
    owner.update(left)
    await owners.whenSettled('retry')
    expect(attempts).toBe(2)
    owner.update(left)
    await owners.whenSettled('retry')
    expect(attempts).toBe(2)
    await owner.release()
  })

  it('keeps a releasing record until its queued hide settles so a new owner cannot race it', async () => {
    let finishFirst!: () => void
    const first = new Promise<void>(resolve => { finishFirst = resolve })
    const calls: Array<NativeBoundsRect | null> = []
    const owners = createNativeSurfaceOwners()
    const sync = async (_id: string, rect: NativeBoundsRect | null) => {
      calls.push(rect)
      if (calls.length === 1) return first
    }
    const old = owners.acquire('durable', sync)
    old.update(left)
    const closing = old.release()
    const next = owners.acquire('durable', sync)
    next.update(right)
    expect(calls).toEqual([left])
    finishFirst()
    await closing
    expect(calls).toEqual([left, right])
    await next.release()
    expect(calls.at(-1)).toBeNull()
  })
})
