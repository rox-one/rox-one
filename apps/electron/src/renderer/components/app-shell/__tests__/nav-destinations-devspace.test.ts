/**
 * Feature-flag gating of the Developers / Playbooks destinations
 * (2026-10-09 pack, D1/D12): the entries exist once in the registry and are
 * visible only while their master atom is on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  APP_NAV_DESTINATIONS_BY_ID,
  visibleNavDestinationsAtom,
} from '../nav-destinations'
import { devSpaceEnabledAtom } from '../../../atoms/dev-space'
import { playbooksEnabledAtom } from '../../../atoms/playbooks'

const originalWindow: unknown = globalThis.window

function memoryStorage(): Storage {
  const data: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(data).length
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = String(value)
    },
    removeItem(key: string) {
      delete data[key]
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null
    },
  }
}

beforeEach(() => {
  globalThis.window = { localStorage: memoryStorage() } as unknown as typeof window
})

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow as typeof window
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('developers / playbooks destination gating', () => {
  it('registers the entries once with the frozen identity', () => {
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.linkId).toBe('nav:developers')
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.labelKey).toBe('sidebar.developers')
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.railGroup).toBe('more')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.linkId).toBe('nav:playbooks')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.labelKey).toBe('sidebar.playbooks')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.railGroup).toBe('more')
  })

  it('hides both entries by default and keeps the existing destinations', () => {
    const store = createStore()
    const ids = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(ids).not.toContain('developers')
    expect(ids).not.toContain('playbooks')
    expect(ids).toContain('sessions')
    expect(ids).toContain('settings')
  })

  it('shows each entry only while its master flag is on', () => {
    const store = createStore()
    store.set(devSpaceEnabledAtom, true)
    const withDevSpace = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(withDevSpace).toContain('developers')
    expect(withDevSpace).not.toContain('playbooks')

    store.set(playbooksEnabledAtom, true)
    const withPlaybooks = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(withPlaybooks).toContain('playbooks')
  })
})