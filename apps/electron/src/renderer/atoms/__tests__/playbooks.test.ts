import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { KEYS, getKeyString } from '../../lib/local-storage'
import { playbooksEnabledAtom } from '../playbooks'

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

describe('playbooksEnabledAtom', () => {
  it('defaults OFF and persists under KEYS.playbooksV1', () => {
    const store = createStore()
    expect(store.get(playbooksEnabledAtom)).toBe(false)

    store.set(playbooksEnabledAtom, true)
    expect(store.get(playbooksEnabledAtom)).toBe(true)
    expect(testWindow.localStorage.getItem(getKeyString(KEYS.playbooksV1))).toBe('true')
  })
})