import { expect, test } from 'bun:test'
import type { ElectronAPI } from '../../../shared/types'
import type { ZenShellSnapshot } from '../../../shared/shell-appearance'
import { subscribeDesktopShellAppearance } from '../shell-appearance-subscription'

const initial: ZenShellSnapshot = { flag: 'shell.zen.v1', enabled: true, preference: 'system', platform: 'darwin', material: 'vibrancy' }
const fallback: ZenShellSnapshot = { ...initial, material: 'solid', fallbackReason: 'gpu-failure' }

function bridge(pending: Promise<ZenShellSnapshot>) {
  let emit!: (snapshot: ZenShellSnapshot) => void
  let disposed = false
  const api: Pick<ElectronAPI, 'getRuntimeEnvironment' | 'getShellSnapshot' | 'onShellChanged'> = {
    getRuntimeEnvironment: () => 'electron',
    getShellSnapshot: () => pending,
    onShellChanged: callback => {
      emit = callback
      return () => { disposed = true }
    },
  }
  return { api, emit: (value: ZenShellSnapshot) => emit(value), disposed: () => disposed }
}

test('a GPU/paint event supersedes the older initial response still in flight', async () => {
  let resolve!: (value: ZenShellSnapshot) => void
  const host = bridge(new Promise(done => { resolve = done }))
  const snapshots: ZenShellSnapshot[] = []
  const stop = subscribeDesktopShellAppearance(host.api, value => snapshots.push(value), () => { throw new Error('Unexpected unavailable') })
  await Promise.resolve()
  host.emit(fallback)
  resolve(initial)
  await new Promise(done => setTimeout(done, 0))
  expect(snapshots).toEqual([fallback])
  stop()
  expect(host.disposed()).toBe(true)
})

test('an initial snapshot followed by a live accessibility change applies both in order', async () => {
  const host = bridge(Promise.resolve(initial))
  const snapshots: ZenShellSnapshot[] = []
  const stop = subscribeDesktopShellAppearance(host.api, value => snapshots.push(value), () => {})
  await new Promise(done => setTimeout(done, 0))
  host.emit({ ...fallback, fallbackReason: 'reduce-transparency' })
  expect(snapshots).toEqual([initial, { ...fallback, fallbackReason: 'reduce-transparency' }])
  stop()
})

test('late callbacks after disposal and stale initial errors cannot replace a live state', async () => {
  let reject!: (error: unknown) => void
  const host = bridge(new Promise((_done, fail) => { reject = fail }))
  const snapshots: ZenShellSnapshot[] = []
  let unavailable = 0
  const stop = subscribeDesktopShellAppearance(host.api, value => snapshots.push(value), () => { unavailable++ })
  await Promise.resolve()
  host.emit(fallback)
  reject(new Error('Initial read failed late'))
  await new Promise(done => setTimeout(done, 0))
  stop()
  host.emit(initial)
  expect(snapshots).toEqual([fallback])
  expect(unavailable).toBe(0)
})

test('web runtime never subscribes to desktop policy or requests a host snapshot', () => {
  let calls = 0
  const host = bridge(Promise.resolve(initial))
  const stop = subscribeDesktopShellAppearance({ ...host.api, getRuntimeEnvironment: () => 'web',
    getShellSnapshot: async () => { calls++; return initial },
    onShellChanged: () => { calls++; return () => {} },
  }, () => { calls++ }, () => { calls++ })
  stop()
  expect(calls).toBe(0)
})
