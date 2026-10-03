import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { RESET } from 'jotai/utils'
import { KEYS, getKeyString } from '../lib/local-storage'

class LayoutStorage implements Storage {
  values = new Map<string, string>()
  denied = false
  get length() { return this.values.size }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) {
    if (this.denied) throw new DOMException('Storage denied', 'SecurityError')
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.denied) throw new DOMException('Quota exhausted', 'QuotaExceededError')
    this.values.set(key, value)
  }
  removeItem(key: string) {
    if (this.denied) throw new DOMException('Storage denied', 'SecurityError')
    this.values.delete(key)
  }
}

const storage = new LayoutStorage()
const fakeWindow = Object.assign(new EventTarget(), { localStorage: storage, Storage: LayoutStorage })
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true })
const { inspectorPanelWidthAtom, bottomDockHeightAtom, clampPersistedLayoutSize, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX } = await import('./unified-shell')
const subscriptions: Array<() => void> = []

function mountedStore() {
  const store = createStore()
  subscriptions.push(store.sub(inspectorPanelWidthAtom, () => {}))
  subscriptions.push(store.sub(bottomDockHeightAtom, () => {}))
  return store
}

beforeEach(() => { storage.clear(); storage.denied = false })
afterEach(() => { for (const off of subscriptions.splice(0)) off() })
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('ROX UI-001 real persisted layout atoms', () => {
  it('bounds live writes before consumers read them and saves the same value', () => {
    const store = mountedStore()
    store.set(bottomDockHeightAtom, 10_000)
    expect(store.get(bottomDockHeightAtom)).toBe(480)
    expect(storage.getItem(getKeyString(KEYS.bottomDockHeight))).toBe('480')
    store.set(bottomDockHeightAtom, Number.NaN)
    expect(store.get(bottomDockHeightAtom)).toBe(104)
    expect(storage.getItem(getKeyString(KEYS.bottomDockHeight))).toBe('104')
  })

  it('retains the inspector host range instead of narrowing valid saved widths', () => {
    storage.setItem(getKeyString(KEYS.inspectorPanelWidth), '1100')
    const store = mountedStore()
    expect(store.get(inspectorPanelWidthAtom)).toBe(1100)
    store.set(inspectorPanelWidthAtom, -1)
    expect(store.get(inspectorPanelWidthAtom)).toBe(280)
    store.set(inspectorPanelWidthAtom, 100_000)
    expect(store.get(inspectorPanelWidthAtom)).toBe(1400)
  })

  it('rounds updater callbacks and reloads canonical values in a fresh store', () => {
    const store = mountedStore()
    store.set(bottomDockHeightAtom, 119.6)
    store.set(bottomDockHeightAtom, value => value + 0.6)
    expect(store.get(bottomDockHeightAtom)).toBe(121)
    expect(mountedStore().get(bottomDockHeightAtom)).toBe(121)
    store.set(inspectorPanelWidthAtom, () => Number.POSITIVE_INFINITY)
    expect(store.get(inspectorPanelWidthAtom)).toBe(320)
  })

  it('recovers malformed JSON, wrong types and non-finite JSON on reload', () => {
    for (const raw of ['{', 'null', '"480"', '[]', '{}', '1e999']) {
      storage.setItem(getKeyString(KEYS.bottomDockHeight), raw)
      expect(mountedStore().get(bottomDockHeightAtom)).toBe(104)
    }
  })

  it('keeps valid live sizes usable when persistence or reset is denied', () => {
    const store = mountedStore()
    storage.denied = true
    expect(() => store.set(bottomDockHeightAtom, 160)).not.toThrow()
    expect(store.get(bottomDockHeightAtom)).toBe(160)
    expect(() => store.set(bottomDockHeightAtom, RESET)).not.toThrow()
    expect(store.get(bottomDockHeightAtom)).toBe(104)
    expect(mountedStore().get(bottomDockHeightAtom)).toBe(104)
  })

  it('normalizes cross-window storage events and unsubscribes on unmount', () => {
    const store = mountedStore()
    const emit = (key: string | null, newValue: string | null) => {
      if (key === null) storage.clear()
      else if (newValue === null) storage.removeItem(key)
      else storage.setItem(key, newValue)
      return fakeWindow.dispatchEvent(Object.assign(new Event('storage'), { key, newValue, storageArea: storage }))
    }
    emit(getKeyString(KEYS.bottomDockHeight), '120.6')
    expect(store.get(bottomDockHeightAtom)).toBe(121)
    emit(getKeyString(KEYS.bottomDockHeight), '1e999')
    expect(store.get(bottomDockHeightAtom)).toBe(104)
    emit(getKeyString(KEYS.inspectorPanelWidth), '5000')
    expect(store.get(inspectorPanelWidthAtom)).toBe(1400)
    emit('unrelated-layout-key', '50')
    expect(store.get(bottomDockHeightAtom)).toBe(104)
    emit(null, null)
    expect(store.get(inspectorPanelWidthAtom)).toBe(320)
    for (const off of subscriptions.splice(0)) off()
    emit(getKeyString(KEYS.bottomDockHeight), '300')
    expect(store.get(bottomDockHeightAtom)).toBe(104)
  })

  it('does not replay an older queued storage value or clear over the current preference', () => {
    const store = mountedStore()
    const key = getKeyString(KEYS.bottomDockHeight)
    storage.setItem(key, '300')
    fakeWindow.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: '100', storageArea: storage }))
    expect(store.get(bottomDockHeightAtom)).toBe(300)
    fakeWindow.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null, storageArea: storage }))
    expect(store.get(bottomDockHeightAtom)).toBe(300)
  })
})

describe('ROX UI-001 persisted shell geometry', () => {
  it('rounds and bounds preferences within the controls existing supported ranges', () => {
    expect(INSPECTOR_PANEL_WIDTH_MIN).toBe(280)
    expect(INSPECTOR_PANEL_WIDTH_MAX).toBe(1400)
    expect(BOTTOM_DOCK_HEIGHT_MIN).toBe(88)
    expect(BOTTOM_DOCK_HEIGHT_MAX).toBe(480)
    expect(clampPersistedLayoutSize(319.6, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(320)
    expect(clampPersistedLayoutSize(-1, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(280)
    expect(clampPersistedLayoutSize(1000, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(1000)
    expect(clampPersistedLayoutSize(10_000, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(1400)
    expect(clampPersistedLayoutSize(1, BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX, 104)).toBe(88)
    expect(clampPersistedLayoutSize(10_000, BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX, 104)).toBe(480)
  })

  it('recovers malformed and non-finite reload values to a usable default', () => {
    for (const value of [undefined, null, '480', {}, [], true, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(clampPersistedLayoutSize(value, 88, 480, 104)).toBe(104)
    }
  })
})
