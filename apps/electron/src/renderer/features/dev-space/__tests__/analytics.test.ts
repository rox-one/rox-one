import { describe, expect, it, beforeEach } from 'bun:test'

// Deterministic in-memory opt-in store; the module reads localStorage defensively.
const store = new Map<string, string>()
try {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    } satisfies Storage,
    configurable: true,
    writable: true,
  })
} catch { /* the host already exposes a usable localStorage */ }

import {
  DEV_SPACE_ANALYTICS_STORAGE_KEY,
  clearDevSpaceDiagnostics,
  emitDevSpaceEvent,
  isDevSpaceAnalyticsEnabled,
  readDevSpaceDiagnostics,
  sanitizeDevSpaceEvent,
  setDevSpaceAnalyticsEnabled,
} from '../analytics'

beforeEach(() => { clearDevSpaceDiagnostics(); store.clear() })

describe('dev-space analytics sanitizer', () => {
  it('keeps only the allowlisted fields of the В1 events', () => {
    expect(sanitizeDevSpaceEvent({ eventName: 'devspace.repo-added', sourceKind: 'git-url', url: 'https://github.com/a/b', path: '/x', name: 'secret' }))
      .toEqual({ eventName: 'devspace.repo-added', sourceKind: 'git-url' })
    expect(sanitizeDevSpaceEvent({ eventName: 'devspace.clone-finished', ok: false, repositoryId: 'devrepo_x' }))
      .toEqual({ eventName: 'devspace.clone-finished', ok: false })
  })

  it('sanitizes the soft signal down to its enum kind', () => {
    expect(sanitizeDevSpaceEvent({ eventName: 'devSpace:softSignal', kind: 'repo-link-pasted', url: 'https://github.com/a/b', path: '/x' }))
      .toEqual({ eventName: 'devSpace:softSignal', kind: 'repo-link-pasted' })
    expect(sanitizeDevSpaceEvent({ eventName: 'devSpace:softSignal', kind: 'git-detected' }))
      .toEqual({ eventName: 'devSpace:softSignal', kind: 'git-detected' })
  })

  it('drops unknown events and invalid enum values', () => {
    expect(sanitizeDevSpaceEvent({ eventName: 'devspace.analysis-run', stage: 'x' })).toBeNull()
    expect(sanitizeDevSpaceEvent({ eventName: 'devspace.repo-added', sourceKind: 'ftp' })).toBeNull()
    expect(sanitizeDevSpaceEvent({ eventName: 'devspace.clone-finished', ok: 'yes' })).toBeNull()
    expect(sanitizeDevSpaceEvent({ eventName: 'devSpace:softSignal', kind: 'ssh-key-found' })).toBeNull()
    expect(sanitizeDevSpaceEvent(null)).toBeNull()
    expect(sanitizeDevSpaceEvent([{ eventName: 'devspace.repo-added', sourceKind: 'git-url' }])).toBeNull()
  })

  it('does not let inherited/prototype fields leak into the event', () => {
    const planted = Object.create({ eventName: 'devspace.repo-added', sourceKind: 'git-url' }) as Record<string, unknown>
    expect(sanitizeDevSpaceEvent(planted)).toBeNull()
  })
})

describe('dev-space analytics opt-in', () => {
  it('records nothing until the user opts in', () => {
    setDevSpaceAnalyticsEnabled(false)
    expect(isDevSpaceAnalyticsEnabled()).toBe(false)
    emitDevSpaceEvent({ eventName: 'devspace.repo-added', sourceKind: 'local-folder' })
    expect(readDevSpaceDiagnostics()).toHaveLength(0)
  })

  it('records sanitized events when enabled', () => {
    setDevSpaceAnalyticsEnabled(true)
    expect(isDevSpaceAnalyticsEnabled()).toBe(true)
    emitDevSpaceEvent({ eventName: 'devspace.clone-finished', ok: true, path: '/secret' })
    const diagnostics = readDevSpaceDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ eventName: 'devspace.clone-finished', ok: true })
    expect(JSON.stringify(diagnostics[0])).not.toContain('/secret')
    setDevSpaceAnalyticsEnabled(false)
    expect(localStorage.getItem(DEV_SPACE_ANALYTICS_STORAGE_KEY)).toBeNull()
  })
})