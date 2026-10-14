import { beforeEach, describe, expect, test } from 'bun:test'
import {
  isExplicitPanelClose,
  pickAutoOpenSessionId,
  readSessionAutoOpenState,
  shouldAutoOpenSession,
  writeSessionAutoOpenState,
} from '../session-auto-open'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const metas = [
  { id: 'old', lastMessageAt: 10 },
  { id: 'newest-archived', lastMessageAt: 99, isArchived: true },
  { id: 'recent', lastMessageAt: 50 },
  { id: 'created-only', createdAt: 20 },
]

describe('pickAutoOpenSessionId', () => {
  test('reopens the last selected session when still listed', () => {
    expect(pickAutoOpenSessionId(metas, 'old')).toBe('old')
  })
  test('falls back to most recent non-archived when last is gone or archived', () => {
    expect(pickAutoOpenSessionId(metas, 'deleted')).toBe('recent')
    expect(pickAutoOpenSessionId(metas, 'newest-archived')).toBe('recent')
    expect(pickAutoOpenSessionId(metas, null)).toBe('recent')
  })
  test('empty list → nothing to open', () => {
    expect(pickAutoOpenSessionId([], 'x')).toBeNull()
    expect(pickAutoOpenSessionId([{ id: 'a', isArchived: true }], null)).toBeNull()
  })
})

describe('auto-open gate and persistence', () => {
  test('state is per workspace and survives reads', () => {
    writeSessionAutoOpenState('ws1', { lastSelectedId: 's1' })
    writeSessionAutoOpenState('ws1', { closed: true })
    expect(readSessionAutoOpenState('ws1')).toEqual({ lastSelectedId: 's1', closed: true })
    expect(readSessionAutoOpenState('ws2')).toEqual({ lastSelectedId: null, closed: false })
  })
  test('corrupt storage falls back to defaults', () => {
    localStorage.setItem('rox.sessions.autoOpen.ws1', '{nope')
    expect(readSessionAutoOpenState('ws1')).toEqual({ lastSelectedId: null, closed: false })
  })
  test('only opens when the catalog owns the workspace, ready, not closed, not searching', () => {
    const base = { catalogOwnsWorkspace: true, isSessionsReady: true, closedByUser: false, searchActive: false }
    expect(shouldAutoOpenSession(base)).toBe(true)
    expect(shouldAutoOpenSession({ ...base, catalogOwnsWorkspace: false })).toBe(false)
    expect(shouldAutoOpenSession({ ...base, isSessionsReady: false })).toBe(false)
    expect(shouldAutoOpenSession({ ...base, closedByUser: true })).toBe(false)
    expect(shouldAutoOpenSession({ ...base, searchActive: true })).toBe(false)
  })
  test('explicit close vs deletion', () => {
    const base = { previousSessionId: 'a', nextSessionId: null, stillOnSessionsList: true, previousSessionStillExists: true }
    expect(isExplicitPanelClose(base)).toBe(true)
    expect(isExplicitPanelClose({ ...base, previousSessionStillExists: false })).toBe(false)
    expect(isExplicitPanelClose({ ...base, stillOnSessionsList: false })).toBe(false)
    expect(isExplicitPanelClose({ ...base, nextSessionId: 'b' })).toBe(false)
    expect(isExplicitPanelClose({ ...base, previousSessionId: null })).toBe(false)
  })
})
