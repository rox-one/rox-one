import { describe, expect, it } from 'bun:test'
import { appShellEffect, deferred, settle } from './rox-readiness-ui-001.effect-harness'
import * as realStorage from '../../../lib/local-storage'
import { loadShellLayout as realLoadShellLayout } from '../../../lib/shell-layout-preferences'

describe('ROX UI-001 actual AppShell workspace callbacks', () => {
  for (const kind of ['Sources', 'Skills'] as const) {
    it(`ignores late ${kind.toLowerCase()} responses after workspace/directory change`, async () => {
      const old = deferred<string[]>()
      const current = deferred<string[]>()
      let data: string[] = []
      const requests: unknown[][] = []
      const api = {
        [`get${kind}`]: (...args: unknown[]) => { requests.push(args); return args[0] === 'old' ? old.promise : current.promise },
        [`on${kind}Changed`]: () => () => {},
      }
      const bindings = (workspace: string) => ({
        window: { electronAPI: api }, activeWorkspaceId: workspace, activeSessionWorkingDirectory: `/work/${workspace}`,
        [`set${kind}`]: (next: string[]) => { data = next }, clearSourceIconCaches: () => {}, console,
      })
      const cleanup = appShellEffect(`electronAPI.get${kind}(`, bindings('old'))
      cleanup?.()
      const cleanupCurrent = appShellEffect(`electronAPI.get${kind}(`, bindings('current'))
      current.resolve(['current-entity']); await settle()
      expect(data).toEqual(['current-entity'])
      old.resolve(['old-entity']); await settle()
      expect(data).toEqual(['current-entity'])
      expect(requests).toEqual(kind === 'Sources' ? [['old'], ['current']] : [['old', '/work/old'], ['current', '/work/current']])
      cleanupCurrent?.()
    })

    it(`keeps a live ${kind.toLowerCase()} deletion ahead of a pending initial snapshot`, async () => {
      const initial = deferred<string[]>()
      let event: ((workspace: string, data: string[]) => void) | undefined
      let data: string[] = []
      let unsubscribed = false
      const api = {
        [`get${kind}`]: () => initial.promise,
        [`on${kind}Changed`]: (callback: NonNullable<typeof event>) => { event = callback; return () => { unsubscribed = true } },
      }
      const bindings = {
        window: { electronAPI: api }, activeWorkspaceId: 'current', activeSessionWorkingDirectory: '/work/current',
        [`set${kind}`]: (next: string[]) => { data = next }, clearSourceIconCaches: () => {}, console,
      }
      const offLoad = appShellEffect(`electronAPI.get${kind}(`, bindings)
      const offEvent = event ? undefined : appShellEffect(`electronAPI.on${kind}Changed(`, bindings)
      event!('other-workspace', ['wrong-entity'])
      expect(data).toEqual([])
      event!('current', [])
      initial.resolve(['deleted-entity']); await settle()
      expect(data).toEqual([])
      offLoad?.(); offEvent?.()
      expect(unsubscribed).toBe(true)
      event!('current', ['late-event'])
      expect(data).toEqual([])
    })
  }

  it('recovers from request rejection and unmount without installing stale data', async () => {
    const request = deferred<string[]>()
    let data = ['previous-workspace']
    let errors = 0
    const cleanup = appShellEffect('electronAPI.getSources(', {
      window: { electronAPI: { getSources: () => request.promise, onSourcesChanged: () => () => {} } },
      activeWorkspaceId: 'current', setSources: (next: string[]) => { data = next },
      clearSourceIconCaches: () => {}, console: { error: () => { errors++ } },
    })
    request.reject(new Error('transport offline')); await settle()
    expect(data).toEqual([])
    expect(errors).toBe(1)
    cleanup?.()
  })

  it('restores workspace geometry before an old pending keyboard resize can commit', () => {
    const values = new Map<string, unknown>([
      ['craft-shell-layout-v1:next', { schemaVersion: 1, workspaceId: 'next', sidebarWidth: 210, navigatorWidth: 410, collapsedSectionIds: [] }],
    ])
    const writes: unknown[] = []
    const store = {
      get: <T>(key: typeof realStorage.KEYS[keyof typeof realStorage.KEYS], fallback: T, suffix?: string): T =>
        (values.get(realStorage.getKeyString(key, suffix)) as T | undefined) ?? fallback,
      set: (...args: unknown[]) => { writes.push(args) },
    }
    let sidebar = 320, navigator = 300
    const order: string[] = []
    appShellEffect('previousWorkspaceRef.current', {
      activeWorkspaceId: 'next', previousWorkspaceRef: { current: 'old' },
      sidebarResize: { handleKeyCancel: () => { order.push('cancel-sidebar') } },
      navigatorResize: { handleKeyCancel: () => { order.push('cancel-navigator') } },
      loadShellLayout: (workspace: string) => realLoadShellLayout(workspace, store),
      setSidebarWidth: (value: number) => { sidebar = value; order.push('load-sidebar') },
      setSessionListWidth: (value: number) => { navigator = value; order.push('load-navigator') },
      setCollectionFilters: () => {}, DEFAULT_COLLECTION_FILTERS: {}, setSearchActive: () => {},
      setSearchQuery: () => {}, setFocusedSidebarItemId: () => {}, setViewFiltersMap: () => {},
      setExpandedFolders: () => {}, setCollapsedItems: () => {}, storage: { KEYS: realStorage.KEYS, get: store.get },
      setWorkspaceUiStateId: () => {},
    })
    expect(sidebar).toBe(210)
    expect(navigator).toBe(410)
    expect(order).toEqual(['cancel-sidebar', 'cancel-navigator', 'load-sidebar', 'load-navigator'])
    expect(writes).toEqual([])
  })
})

// Effects are evaluated independently to reproduce the first render of a workspace switch.
describe('ROX UI-001 workspace persistence isolation', () => {
  for (const key of ['viewFilters', 'collapsedSidebarItems'] as const) {
    it(`does not save old ${key} over the next workspace during restoration`, () => {
      const writes: unknown[][] = []
      appShellEffect(`storage.set(storage.KEYS.${key},`, {
        activeWorkspaceId: 'next', workspaceUiStateId: 'old',
        viewFiltersMap: { oldFilter: {} }, collapsedItems: new Set(['old-section']),
        storage: { KEYS: realStorage.KEYS, set: (...args: unknown[]) => { writes.push(args) } },
        commitShellLayout: (...args: unknown[]) => { writes.push(args) },
      })
      expect(writes).toEqual([])
    })
  }
})
