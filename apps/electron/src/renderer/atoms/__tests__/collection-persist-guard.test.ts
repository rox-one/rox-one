import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createStore } from 'jotai'
import { windowWorkspaceIdAtom } from '../sessions'
import { collectionFilterKeyAtom, collectionFiltersAtom, collectionFiltersMapAtom, loadCollectionFiltersAtom, replaceCollectionFiltersMapAtom } from '../collection-filters'
import { collectionDisplayAtom, loadCollectionDisplayAtom, replaceCollectionDisplayAtom, setCollectionDisplayAtom } from '../collection-display'
import { DEFAULT_COLLECTION_DISPLAY, DEFAULT_COLLECTION_FILTERS } from '@rox/shared/sessions/collection'
import { loadCollectionFiltersMap, saveCollectionFiltersMap } from '@rox/shared/sessions/collection-filters-storage'
import { loadCollectionDisplay, saveCollectionDisplay } from '@rox/shared/sessions/collection-display-storage'
import { appShellEffect, deferred, settle } from '../../components/app-shell/__tests__/rox-readiness-ui-001.effect-harness'

const oldWindow = globalThis.window
const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
  if (oldWindow) globalThis.window = oldWindow
  else delete (globalThis as any).window
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-collection-owner-')); roots.push(root)
  const locations = { a: join(root, 'a'), b: join(root, 'b') }
  const writes: Array<{ workspace: string; map: unknown }> = []
  const api = {
    getCollectionFilters: async (workspace: keyof typeof locations) => loadCollectionFiltersMap(locations[workspace]),
    setCollectionFilters: async (workspace: keyof typeof locations, map: Parameters<typeof saveCollectionFiltersMap>[1]) => {
      writes.push({ workspace, map }); return saveCollectionFiltersMap(locations[workspace], map)
    },
    getCollectionDisplay: async (workspace: keyof typeof locations) => loadCollectionDisplay(locations[workspace]),
    setCollectionDisplay: async (workspace: keyof typeof locations, display: typeof DEFAULT_COLLECTION_DISPLAY) => saveCollectionDisplay(locations[workspace], display),
  }
  globalThis.window = { electronAPI: api } as unknown as typeof window
  const store = createStore(); store.set(windowWorkspaceIdAtom, 'a')
  return { root, locations, writes, api, store }
}
function shellBindings(f: ReturnType<typeof fixture>, previous: string | null, active = 'b') {
  return {
    activeWorkspaceId: active, previousWorkspaceRef: { current: previous },
    setCollectionFilters: (filters: any) => f.store.set(collectionFiltersAtom, filters), DEFAULT_COLLECTION_FILTERS,
    loadCollectionDisplay: (id: string) => f.store.set(loadCollectionDisplayAtom, id),
    loadCollectionFilters: (id: string) => f.store.set(loadCollectionFiltersAtom, id),
    setSearchActive: () => {}, setSearchQuery: () => {}, setViewFiltersMap: () => {},
    setExpandedFolders: () => {}, setCollapsedItems: () => {}, setWorkspaceUiStateId: () => {},
    sidebarResize: { handleKeyCancel: () => {} }, navigatorResize: { handleKeyCancel: () => {} },
    loadShellLayout: () => ({ sidebarWidth: 200, navigatorWidth: 280 }),
    setSidebarWidth: () => {}, setSessionListWidth: () => {},
    storage: { KEYS: {}, get: (_key: unknown, fallback: unknown) => fallback },
  }
}
// Compile the current consumer expression/callback, with real collection atoms.
function shellDeclaration(name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(new URL('../../components/app-shell/AppShell.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expr: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expr = node.initializer
    ts.forEachChild(node, visit)
  }; visit(ast)
  if (!expr) throw new Error('Current consumer missing: ' + name)
  if (ts.isCallExpression(expr) && expr.expression.getText(ast) === 'useCallback') expr = expr.arguments[0]!
  const js = ts.transpileModule('return (' + expr.getText(ast) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return Function(...Object.keys(bindings), js)(...Object.values(bindings))
}

describe('actual AppShell collection workspace persistence', () => {
  for (const previous of ['a', null]) it(`loads native workspace preferences without writing defaults (previous ${previous})`, async () => {
    const f = fixture()
    saveCollectionFiltersMap(f.locations.a, { allSessions: { labels: ['a-only'] } })
    const persistedB = saveCollectionFiltersMap(f.locations.b, { allSessions: { status: ['todo'] }, flagged: { flagged: true } })
    saveCollectionDisplay(f.locations.b, { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'project' as const })
    await f.store.set(loadCollectionFiltersAtom, 'a')
    f.store.set(windowWorkspaceIdAtom, 'b')
    appShellEffect('previousWorkspaceRef.current', shellBindings(f, previous))
    await new Promise(resolve => setTimeout(resolve, 0)); await settle()
    expect(f.writes).toEqual([])
    expect(loadCollectionFiltersMap(f.locations.b)).toEqual(persistedB)
    expect(f.store.get(collectionFiltersMapAtom)).toEqual(persistedB)
    expect(f.store.get(collectionDisplayAtom).groupBy).toBe('project')
  })

  it('uses the canonical project grouping and never persists a second legacy grouping state', async () => {
    const f = fixture(); const legacyWrites: unknown[] = []
    saveCollectionDisplay(f.locations.a, { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'project' as const })
    await f.store.set(loadCollectionDisplayAtom, 'a')
    const bindings = { isStateSubView: false, collectionDisplay: f.store.get(collectionDisplayAtom), viewFiltersMap: { allSessions: { groupingMode: 'unread' } }, sessionFilterKey: 'allSessions' }
    expect(shellDeclaration('chatGroupingMode', bindings)).toBe('project')
    const change = shellDeclaration('setChatGroupingMode', { ...bindings, setViewFiltersMap: (value: unknown) => legacyWrites.push(value), setCollectionDisplay: (value: any) => f.store.set(setCollectionDisplayAtom, value) })
    change('project'); await new Promise(resolve => setTimeout(resolve, 0)); await settle()
    expect(loadCollectionDisplay(f.locations.a).groupBy).toBe('project')
    expect(legacyWrites).toEqual([])
    expect(shellDeclaration('chatGroupingMode', { ...bindings, collectionDisplay: { ...bindings.collectionDisplay, groupBy: 'none' } })).toBe('date')
    expect(shellDeclaration('chatGroupingMode', { ...bindings, isStateSubView: true })).toBe('date')
  })
})

describe('current collection load/edit lifetime', () => {
  for (const kind of ['filters', 'display'] as const) {

    it(`${kind} a new workspace edit cannot inherit the previous workspace snapshot`, async () => {
      const f = fixture(), held = deferred<any>()
      const load = kind === 'filters' ? loadCollectionFiltersAtom : loadCollectionDisplayAtom
      if (kind === 'filters') saveCollectionFiltersMap(f.locations.a, { allSessions: { labels: ['private-a'] }, flagged: { flagged: true } })
      else saveCollectionDisplay(f.locations.a, { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'status', visibleProperties: ['model'] })
      await f.store.set(load as any, 'a')
      const key = kind === 'filters' ? 'getCollectionFilters' : 'getCollectionDisplay'
      ;(f.api as any)[key] = () => held.promise
      f.store.set(windowWorkspaceIdAtom, 'b')
      const pending = f.store.set(load as any, 'b')
      if (kind === 'filters') await f.store.set(collectionFiltersAtom, { labels: ['edited-b'] })
      else await f.store.set(setCollectionDisplayAtom, { groupBy: 'project' as const })
      held.resolve(kind === 'filters' ? {} : DEFAULT_COLLECTION_DISPLAY); await pending
      if (kind === 'filters') expect(Object.keys(loadCollectionFiltersMap(f.locations.b))).toEqual(['allSessions'])
      else expect(loadCollectionDisplay(f.locations.b).visibleProperties).toEqual(DEFAULT_COLLECTION_DISPLAY.visibleProperties)
    })

    it(`${kind} reload follows a dispatched durable write before taking its snapshot`, async () => {
      const f = fixture(), held = deferred<void>(); let reads = 0
      const writeKey = kind === 'filters' ? 'setCollectionFilters' : 'setCollectionDisplay'
      const originalWrite = (f.api as any)[writeKey]
      ;(f.api as any)[writeKey] = async (...args: any[]) => { await held.promise; return originalWrite(...args) }
      const readKey = kind === 'filters' ? 'getCollectionFilters' : 'getCollectionDisplay'
      const originalRead = (f.api as any)[readKey]
      ;(f.api as any)[readKey] = async (...args: any[]) => { reads++; return originalRead(...args) }
      const write = kind === 'filters' ? f.store.set(collectionFiltersAtom, { labels: ['confirmed'] }) : f.store.set(setCollectionDisplayAtom, { groupBy: 'project' as const })
      const reload = f.store.set((kind === 'filters' ? loadCollectionFiltersAtom : loadCollectionDisplayAtom) as any, 'a')
      await settle(); expect(reads).toBe(0)
      held.resolve(); await write; await reload
      expect(reads).toBe(1)
      expect(kind === 'filters' ? f.store.get(collectionFiltersAtom).labels : f.store.get(collectionDisplayAtom).groupBy).toEqual(kind === 'filters' ? ['confirmed'] : 'project')
    })

    it(`${kind} latest workspace ABA load rejects the first same-ID reply`, async () => {
      const f = fixture(), held = deferred<any>(); let reads = 0
      const load = kind === 'filters' ? loadCollectionFiltersAtom : loadCollectionDisplayAtom
      const live = kind === 'filters' ? collectionFiltersMapAtom : collectionDisplayAtom
      const stale = kind === 'filters' ? { allSessions: { labels: ['stale-a'] } } : { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'status' as const }
      const latest = kind === 'filters' ? { allSessions: { labels: ['latest-a'] } } : { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'project' as const }
      const key = kind === 'filters' ? 'getCollectionFilters' : 'getCollectionDisplay'
      ;(f.api as any)[key] = async () => ++reads === 1 ? held.promise : latest
      const first = f.store.set(load as any, 'a')
      await settle(); expect(reads).toBe(1)
      f.store.set(windowWorkspaceIdAtom, 'b'); await f.store.set(load as any, 'b')
      f.store.set(windowWorkspaceIdAtom, 'a'); await f.store.set(load as any, 'a')
      held.resolve(stale); await first
      expect(kind === 'filters' ? f.store.get(collectionFiltersMapAtom) : f.store.get(collectionDisplayAtom)).toEqual(latest)
    })

    it(`${kind} a later durable edit survives a held initial snapshot`, async () => {
      const f = fixture(), held = deferred<any>()
      const key = kind === 'filters' ? 'getCollectionFilters' : 'getCollectionDisplay'
      ;(f.api as any)[key] = () => held.promise
      const load = kind === 'filters' ? loadCollectionFiltersAtom : loadCollectionDisplayAtom
      const before = kind === 'filters' ? { allSessions: { labels: ['before'] } } : { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'status' as const }
      const pending = f.store.set(load as any, 'a')
      if (kind === 'filters') await f.store.set(collectionFiltersAtom, { labels: ['edited'] })
      else await f.store.set(setCollectionDisplayAtom, { groupBy: 'project' as const })
      held.resolve(before); await pending
      expect(kind === 'filters' ? f.store.get(collectionFiltersAtom) : f.store.get(collectionDisplayAtom).groupBy).toEqual(kind === 'filters' ? { labels: ['edited'] } : 'project')
      expect(kind === 'filters' ? loadCollectionFiltersMap(f.locations.a).allSessions : loadCollectionDisplay(f.locations.a).groupBy).toEqual(kind === 'filters' ? { labels: ['edited'] } : 'project')
    })

    it(`${kind} live confirmed replacement beats a held snapshot`, async () => {
      const f = fixture(), held = deferred<any>()
      const key = kind === 'filters' ? 'getCollectionFilters' : 'getCollectionDisplay'
      ;(f.api as any)[key] = () => held.promise
      const latest = kind === 'filters' ? { allSessions: { labels: ['live'] } } : { ...DEFAULT_COLLECTION_DISPLAY, groupBy: 'project' as const }
      const pending = f.store.set((kind === 'filters' ? loadCollectionFiltersAtom : loadCollectionDisplayAtom) as any, 'a')
      f.store.set((kind === 'filters' ? replaceCollectionFiltersMapAtom : replaceCollectionDisplayAtom) as any, latest)
      held.resolve(kind === 'filters' ? {} : DEFAULT_COLLECTION_DISPLAY); await pending
      expect(kind === 'filters' ? f.store.get(collectionFiltersMapAtom) : f.store.get(collectionDisplayAtom)).toEqual(latest)
    })
  }
})
