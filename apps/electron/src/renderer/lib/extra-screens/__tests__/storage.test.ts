import { afterEach, describe, expect, it } from 'bun:test'
import {
  readWorkspaceJsonSnapshot,
  saveWorkspaceJson,
  saveWorkspaceJsonIfUnchanged,
  workspaceStorageKey,
} from '../storage'

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const values = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)) },
  removeItem: (key: string) => { values.delete(key) },
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size },
} as Storage

function useTestStorage() {
  values.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
  })
}

afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  values.clear()
})

describe('workspace JSON storage writes', () => {
  it('writes a value only when its opened snapshot is still current', () => {
    useTestStorage()
    const key = workspaceStorageKey('home-dashboard', 'workspace-a')
    expect(saveWorkspaceJsonIfUnchanged('home-dashboard', 'workspace-a', null, { version: 2, widgets: [] })).toBe(true)
    const firstRaw = values.get(key)
    expect(firstRaw).toBe('{"version":2,"widgets":[]}')
    expect(saveWorkspaceJsonIfUnchanged('home-dashboard', 'workspace-a', null, { version: 2, widgets: [{ id: 'feed', size: 'M' }] })).toBe(false)
    expect(values.get(key)).toBe(firstRaw)
    expect(saveWorkspaceJsonIfUnchanged('home-dashboard', 'workspace-a', firstRaw!, { version: 2, widgets: [{ id: 'feed', size: 'M' }] })).toBe(true)
    expect(JSON.parse(values.get(key)!)).toEqual({ version: 2, widgets: [{ id: 'feed', size: 'M' }] })
  })

  it('keeps malformed bytes available for recovery instead of treating a default as saved data', () => {
    useTestStorage()
    const key = workspaceStorageKey('home-dashboard', 'workspace-a')
    values.set(key, '{broken')
    const snapshot = readWorkspaceJsonSnapshot('home-dashboard', 'workspace-a', (value) => value ?? 'default')
    expect(snapshot.available).toBe(true)
    expect(snapshot.valid).toBe(false)
    expect(snapshot.raw).toBe('{broken')
    expect(saveWorkspaceJsonIfUnchanged('home-dashboard', 'workspace-a', null, 'replacement')).toBe(false)
    expect(values.get(key)).toBe('{broken')
  })

  it('reports storage unavailability instead of claiming a successful write', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    expect(saveWorkspaceJson('home-dashboard', 'workspace-a', { version: 2, widgets: [] })).toBe(false)
  })
})
