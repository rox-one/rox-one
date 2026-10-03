import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { RESET } from 'jotai/utils'
import { KEYS, getKeyString } from '../lib/local-storage'
import { bottomDockHeightAtom, inspectorPanelWidthAtom } from './unified-shell'

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>()
  failRead = false
  failWrite = false
  failRemove = false
  get length() { return this.data.size }
  clear() { this.data.clear() }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) {
    if (this.failRead) throw new Error('storage unavailable')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrite) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    if (this.failRemove) throw new Error('storage removal unavailable')
    this.data.delete(key)
  }
}

const targets = [
  { name: 'inspector', atom: inspectorPanelWidthAtom, key: getKeyString(KEYS.inspectorPanelWidth), fallback: 320, min: 280, max: 1400 },
  { name: 'terminal dock', atom: bottomDockHeightAtom, key: getKeyString(KEYS.bottomDockHeight), fallback: 104, min: 88, max: 480 },
] as const
let storage: MemoryStorage
let listeners: Set<(event: StorageEvent) => void>
let priorStorage: PropertyDescriptor | undefined
let priorWindow: PropertyDescriptor | undefined
const disposers: Array<() => void> = []

beforeEach(() => {
  storage = new MemoryStorage()
  listeners = new Set()
  priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener(type: string, callback: (event: StorageEvent) => void) { if (type === 'storage') listeners.add(callback) },
      removeEventListener(type: string, callback: (event: StorageEvent) => void) { if (type === 'storage') listeners.delete(callback) },
    },
  })
})
afterEach(() => {
  while (disposers.length) disposers.pop()!()
  if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})
function mountedStore(target: typeof targets[number]) {
  const store = createStore()
  disposers.push(store.sub(target.atom, () => {}))
  return store
}
function emitQueued(key: string | null, newValue: string | null, area: Storage = storage) {
  for (const listener of [...listeners]) listener({ key, newValue, storageArea: area } as StorageEvent)
}
function emit(key: string | null, newValue: string | null, area: Storage = storage) {
  // A live write changes its backing store before the receiving window is notified.
  if (key === null) area.clear()
  else if (newValue === null) area.removeItem(key)
  else area.setItem(key, newValue)
  emitQueued(key, newValue, area)
}

describe('ROX UI-001 real Jotai layout storage behavior', () => {
  for (const target of targets) {
    it(`${target.name}: validates direct and functional writes before publishing or persisting`, () => {
      const store = mountedStore(target)
      expect(store.get(target.atom)).toBe(target.fallback)
      for (const [value, expected] of [[-20, target.min], [10_000, target.max], [target.fallback + 0.6, target.fallback + 1]] as const) {
        store.set(target.atom, value)
        expect(store.get(target.atom)).toBe(expected)
        expect(storage.getItem(target.key)).toBe(JSON.stringify(expected))
      }
      let previousValue: number | undefined
      store.set(target.atom, (previous) => { previousValue = previous; return 10_000 })
      expect(previousValue).toBe(target.fallback + 1)
      expect(store.get(target.atom)).toBe(target.max)
      expect(storage.getItem(target.key)).toBe(JSON.stringify(target.max))
      store.set(target.atom, () => Number.NaN)
      expect(store.get(target.atom)).toBe(target.fallback)
      for (const invalid of [Number.NaN, Infinity, -Infinity, null, undefined, '480', {}, true]) {
        store.set(target.atom, invalid as number)
        expect(store.get(target.atom)).toBe(target.fallback)
        expect(storage.getItem(target.key)).toBe(JSON.stringify(target.fallback))
      }
    })
    it(`${target.name}: supports direct and functional RESET and remounts the default`, () => {
      const store = mountedStore(target)
      store.set(target.atom, target.max)
      store.set(target.atom, RESET)
      expect(store.get(target.atom)).toBe(target.fallback)
      expect(storage.getItem(target.key)).toBeNull()
      store.set(target.atom, target.min)
      store.set(target.atom, () => RESET)
      expect(store.get(target.atom)).toBe(target.fallback)
      expect(storage.getItem(target.key)).toBeNull()
      expect(mountedStore(target).get(target.atom)).toBe(target.fallback)
    })
    it(`${target.name}: restores normalized saved values on remount`, () => {
      for (const [raw, expected] of [
        ['-20', target.min], ['10000', target.max], [String(target.fallback + 0.6), target.fallback + 1],
        ['null', target.fallback], ['"480"', target.fallback], ['{}', target.fallback], ['[400]', target.fallback],
        ['true', target.fallback], ['1e999', target.fallback], ['broken JSON', target.fallback],
      ] as const) {
        storage.setItem(target.key, raw)
        expect(mountedStore(target).get(target.atom)).toBe(expected)
      }
      mountedStore(target).set(target.atom, target.fallback + 40.4)
      expect(mountedStore(target).get(target.atom)).toBe(target.fallback + 40)
    })
    it(`${target.name}: tolerates unavailable reads, quota errors and failed reset removal`, () => {
      storage.failRead = true
      const store = mountedStore(target)
      expect(store.get(target.atom)).toBe(target.fallback)
      storage.failWrite = true
      expect(() => store.set(target.atom, 10_000)).not.toThrow()
      expect(store.get(target.atom)).toBe(target.max)
      expect(storage.data.has(target.key)).toBe(false)
      storage.failRemove = true
      expect(() => store.set(target.atom, RESET)).not.toThrow()
      expect(store.get(target.atom)).toBe(target.fallback)
    })
    it(`${target.name}: normalizes current canonical storage through races, corrupt values and deletion`, () => {
      const store = mountedStore(target)
      storage.setItem(target.key, String(target.max)) // Store advanced beyond queued snapshots.
      emitQueued(target.key, String(target.fallback + 20.6))
      expect(store.get(target.atom)).toBe(target.max)
      emitQueued(target.key, null)
      expect(store.get(target.atom)).toBe(target.max)
      emitQueued(null, null)
      expect(store.get(target.atom)).toBe(target.max)
      expect(storage.getItem(target.key)).toBe(String(target.max))
      expect(mountedStore(target).get(target.atom)).toBe(target.max)
      emit(target.key, String(target.fallback + 20.6))
      expect(store.get(target.atom)).toBe(target.fallback + 21)
      emit(target.key, '-20')
      expect(store.get(target.atom)).toBe(target.min)
      emit(target.key, '10000')
      expect(store.get(target.atom)).toBe(target.max)
      emit(target.key, 'malformed')
      expect(store.get(target.atom)).toBe(target.fallback)
      emit(target.key, String(target.min))
      emit(target.key, null)
      expect(store.get(target.atom)).toBe(target.fallback)
      expect(storage.getItem(target.key)).toBeNull()
      expect(mountedStore(target).get(target.atom)).toBe(target.fallback)
      emit(target.key, String(target.min))
      expect(mountedStore(target).get(target.atom)).toBe(target.min)
      emit(null, null)
      expect(store.get(target.atom)).toBe(target.fallback)
      expect(storage.getItem(target.key)).toBeNull()
      expect(mountedStore(target).get(target.atom)).toBe(target.fallback)
    })
    it(`${target.name}: filters other keys/storage areas and releases subscriptions`, () => {
      const store = createStore()
      const first = store.sub(target.atom, () => {})
      const second = store.sub(target.atom, () => {})
      expect(listeners.size).toBe(1)
      emit('another-key', String(target.max))
      emit(target.key, String(target.max), new MemoryStorage())
      emit(null, null, new MemoryStorage())
      expect(store.get(target.atom)).toBe(target.fallback)
      first()
      expect(listeners.size).toBe(1)
      emit(target.key, String(target.max))
      expect(store.get(target.atom)).toBe(target.max)
      second()
      expect(listeners.size).toBe(0)
      emit(target.key, String(target.min))
      expect(store.get(target.atom)).toBe(target.max)
    })
  }
  it('uses defaults and remains writable when storage access throws or is absent', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
    for (const target of targets) {
      const store = mountedStore(target)
      expect(store.get(target.atom)).toBe(target.fallback)
      expect(() => store.set(target.atom, 10_000)).not.toThrow()
      expect(store.get(target.atom)).toBe(target.max)
      expect(() => store.set(target.atom, RESET)).not.toThrow()
      expect(store.get(target.atom)).toBe(target.fallback)
    }
    Reflect.deleteProperty(globalThis, 'localStorage')
    Reflect.deleteProperty(globalThis, 'window')
    for (const target of targets) {
      const store = mountedStore(target)
      expect(store.get(target.atom)).toBe(target.fallback)
      store.set(target.atom, target.min)
      expect(store.get(target.atom)).toBe(target.min)
    }
    expect(listeners.size).toBe(0)
  })
})
