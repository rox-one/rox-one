import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  canPaintShellFromCache,
  clearStartupShellCache,
  parseStartupShellCache,
  readStartupShellCache,
  writeStartupShellCache,
} from '../startup-shell-cache'
import * as storage from '../local-storage'

const originalWindow = globalThis.window

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { window: unknown; localStorage: Storage }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: () => null,
      length: 0,
    },
  }
  ;(globalThis as unknown as { localStorage: Storage }).localStorage =
    (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
})

afterEach(() => {
  ;(globalThis as unknown as { window: unknown }).window = originalWindow
})

describe('parseStartupShellCache', () => {
  it('accepts local and native entries', () => {
    expect(parseStartupShellCache({ workspaceId: 'ws-a', authority: 'local' }))
      .toEqual({ workspaceId: 'ws-a', authority: 'local' })
    expect(parseStartupShellCache({ workspaceId: 'ws-b', authority: 'native' }))
      .toEqual({ workspaceId: 'ws-b', authority: 'native' })
  })

  it('rejects malformed payloads', () => {
    expect(parseStartupShellCache(null)).toBeNull()
    expect(parseStartupShellCache({})).toBeNull()
    expect(parseStartupShellCache({ workspaceId: '', authority: 'local' })).toBeNull()
    expect(parseStartupShellCache({ workspaceId: 'ws', authority: 'cloud' })).toBeNull()
    expect(parseStartupShellCache({ workspaceId: 1, authority: 'local' })).toBeNull()
  })
})

describe('read/write/clearStartupShellCache', () => {
  it('round-trips through localStorage', () => {
    expect(readStartupShellCache()).toBeNull()
    writeStartupShellCache({ workspaceId: 'ws-1', authority: 'local' })
    expect(readStartupShellCache()).toEqual({ workspaceId: 'ws-1', authority: 'local' })
    expect(storage.get<{ workspaceId: string; authority: string } | null>(storage.KEYS.startupShellCache, null)).toEqual({
      workspaceId: 'ws-1',
      authority: 'local',
    })
    clearStartupShellCache()
    expect(readStartupShellCache()).toBeNull()
  })

  it('ignores write of invalid entry', () => {
    // Bypass the public type so parseStartupShellCache can reject empty ids.
    writeStartupShellCache({ workspaceId: '', authority: 'local' } as { workspaceId: string; authority: 'local' })
    expect(readStartupShellCache()).toBeNull()
  })
})

describe('canPaintShellFromCache', () => {
  const cache = { workspaceId: 'ws-1', authority: 'local' as const }

  it('requires matching bound workspace', () => {
    expect(canPaintShellFromCache(cache, 'ws-1')).toBe(true)
    expect(canPaintShellFromCache(cache, 'ws-other')).toBe(false)
    expect(canPaintShellFromCache(cache, null)).toBe(false)
    expect(canPaintShellFromCache(cache, '')).toBe(false)
    expect(canPaintShellFromCache(null, 'ws-1')).toBe(false)
  })
})
