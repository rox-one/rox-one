import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { KEYS, getKeyString } from '../../../lib/local-storage'
import { devSpaceEnabledAtom } from '../../../atoms/dev-space'
import {
  clearDevSpaceDiagnostics,
  readDevSpaceDiagnostics,
  setDevSpaceAnalyticsEnabled,
} from '../../../features/dev-space/analytics'
import {
  DEV_SPACE_NUDGE_SNOOZE_MS,
  emitDevSpaceSoftSignal,
  isDevSpaceNudgeVisible,
  isGitHubRepoLink,
} from '../DevSpaceNudgeBanner'

const originalWindow: unknown = globalThis.window
const originalLocalStorage: unknown = globalThis.localStorage

// Deterministic in-memory opt-in store; the module reads localStorage defensively.
const store = new Map<string, string>()

function installLocalStorage(value: Storage): void {
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value,
      configurable: true,
      writable: true,
    })
  } catch { /* the host already exposes a usable localStorage */ }
}

function memoryStorage(): Storage {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }
}

let storage: Storage

beforeEach(() => {
  store.clear()
  storage = memoryStorage()
  installLocalStorage(storage)
  globalThis.window = { localStorage: storage } as unknown as typeof window
  clearDevSpaceDiagnostics()
})

afterEach(() => {
  setDevSpaceAnalyticsEnabled(false)
  clearDevSpaceDiagnostics()
  if (originalWindow) globalThis.window = originalWindow as typeof window
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalLocalStorage) installLocalStorage(originalLocalStorage as Storage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('isGitHubRepoLink', () => {
  it('accepts a bare https repository link with optional .git or trailing slash', () => {
    expect(isGitHubRepoLink('https://github.com/rox/one')).toBe(true)
    expect(isGitHubRepoLink('https://github.com/rox/one.git')).toBe(true)
    expect(isGitHubRepoLink('https://github.com/rox/one/')).toBe(true)
    expect(isGitHubRepoLink('  https://github.com/rox/one.git  ')).toBe(true)
    expect(isGitHubRepoLink('https://github.com/rox/one\n')).toBe(true)
  })

  it('rejects anything that is not a single repository link', () => {
    expect(isGitHubRepoLink('https://github.com/rox')).toBe(false)
    expect(isGitHubRepoLink('https://github.com/rox/one/issues')).toBe(false)
    expect(isGitHubRepoLink('https://github.com/rox/one?tab=readme')).toBe(false)
    expect(isGitHubRepoLink('git@github.com:rox/one.git')).toBe(false)
    expect(isGitHubRepoLink('https://gitlab.com/rox/one')).toBe(false)
    expect(isGitHubRepoLink('see https://github.com/rox/one')).toBe(false)
    expect(isGitHubRepoLink('https://github.com/rox/one extra')).toBe(false)
    expect(isGitHubRepoLink(null)).toBe(false)
  })
})

describe('dev-space nudge visibility', () => {
  const base = { enabled: false, seen: null, reminder: { count: 0 }, signaled: true } as const

  it('shows only after a soft signal while the flag is off and the nudge is undecided', () => {
    expect(isDevSpaceNudgeVisible(base)).toBe(true)
    expect(isDevSpaceNudgeVisible({ ...base, signaled: false })).toBe(false)
    expect(isDevSpaceNudgeVisible({ ...base, enabled: true })).toBe(false)
    expect(isDevSpaceNudgeVisible({ ...base, seen: true })).toBe(false)
    expect(isDevSpaceNudgeVisible({ ...base, seen: false })).toBe(false)
  })

  it('stays hidden while the reminder is snoozed, then returns', () => {
    const reminder = { count: 1, dismissedUntil: 1_000 }
    expect(isDevSpaceNudgeVisible({ ...base, reminder, now: 500 })).toBe(false)
    expect(isDevSpaceNudgeVisible({ ...base, reminder, now: 2_000 })).toBe(true)
  })

  it('snoozes a dismissal for a non-zero window', () => {
    expect(DEV_SPACE_NUDGE_SNOOZE_MS).toBeGreaterThan(0)
  })
})

describe('emitDevSpaceSoftSignal', () => {
  it('never enables the Developer Space flag', () => {
    const store = createStore()
    emitDevSpaceSoftSignal('repo-link-pasted')
    expect(store.get(devSpaceEnabledAtom)).toBe(false)
    expect(storage.getItem(getKeyString(KEYS.devSpaceV1))).toBeNull()
  })

  it('records only the allowlisted enum when the user opted in', () => {
    setDevSpaceAnalyticsEnabled(true)
    emitDevSpaceSoftSignal('git-detected')
    expect(readDevSpaceDiagnostics()).toMatchObject([{ eventName: 'devSpace:softSignal', kind: 'git-detected' }])
  })

  it('records nothing while analytics stay opt-out', () => {
    emitDevSpaceSoftSignal('repo-link-pasted')
    expect(readDevSpaceDiagnostics()).toHaveLength(0)
  })
})