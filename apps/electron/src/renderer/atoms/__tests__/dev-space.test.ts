import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { KEYS, getKeyString } from '../../lib/local-storage'
import {
  devSpaceEnabledAtom,
  devSpaceNudgeSeenAtom,
  devSpaceReminderStateAtom,
  onboardingRoleAtom,
} from '../dev-space'

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

let testWindow: { localStorage: Storage }

beforeEach(() => {
  testWindow = { localStorage: memoryStorage() }
  globalThis.window = testWindow as unknown as typeof window
})

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow as typeof window
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('dev-space atoms', () => {
  it('defaults: OFF, no role answer, empty reminder, nudge not seen', () => {
    const store = createStore()
    expect(store.get(devSpaceEnabledAtom)).toBe(false)
    expect(store.get(onboardingRoleAtom)).toBeNull()
    expect(store.get(devSpaceReminderStateAtom)).toEqual({ count: 0 })
    expect(store.get(devSpaceNudgeSeenAtom)).toBeNull()
  })

  it('persists writes under their craft- prefixed KEYS', () => {
    const store = createStore()
    store.set(devSpaceEnabledAtom, true)
    store.set(onboardingRoleAtom, { isDeveloper: true, relatedRoles: ['analyst'], skipped: false })
    store.set(devSpaceReminderStateAtom, { count: 1, lastShownAt: 42 })
    store.set(devSpaceNudgeSeenAtom, true)

    expect(testWindow.localStorage.getItem(getKeyString(KEYS.devSpaceV1))).toBe('true')
    expect(testWindow.localStorage.getItem(getKeyString(KEYS.onboardingRole))).toBe(
      JSON.stringify({ isDeveloper: true, relatedRoles: ['analyst'], skipped: false }),
    )
    expect(testWindow.localStorage.getItem(getKeyString(KEYS.devSpaceReminderState))).toBe(
      JSON.stringify({ count: 1, lastShownAt: 42 }),
    )
    expect(testWindow.localStorage.getItem(getKeyString(KEYS.devSpaceNudge))).toBe('true')
  })

  it('round-trips values set back through the same store', () => {
    const store = createStore()
    store.set(devSpaceEnabledAtom, true)
    expect(store.get(devSpaceEnabledAtom)).toBe(true)
    store.set(devSpaceReminderStateAtom, { count: 3 })
    expect(store.get(devSpaceReminderStateAtom)).toEqual({ count: 3 })
    store.set(devSpaceNudgeSeenAtom, false)
    expect(store.get(devSpaceNudgeSeenAtom)).toBe(false)
  })
})