import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import {
  panelStackAtom, focusedPanelIdAtom, focusedPanelRouteAtom, focusedPanelIndexAtom,
  reconcilePanelStackAtom, updateFocusedPanelRouteAtom,
} from '../../../atoms/panel-stack'
import { focusServicePanelAtom } from '../service-navigation'
import { APP_NAV_DESTINATIONS_BY_ID } from '../nav-destinations'
import {
  parseRoute, parseRouteToNavigationState, resolveRouteNavigationState,
  buildRouteFromNavigationState, buildRightSidebarParam,
} from '../../../../shared/route-parser'
import { isSessionsNavigation, DEFAULT_NAVIGATION_STATE } from '../../../../shared/types'
import { sessionMetaMapAtom } from '../../../atoms/sessions'
import { preserveRouteQuery, normalizePanelRouteForReconcile } from '../../../contexts/navigation-reconcile'

import { decodePanelEntries, encodePanelEntries } from '../../../lib/panel-url'

const navURL = new URL('../../../contexts/NavigationContext.tsx', import.meta.url)
const shellURL = new URL('../AppShell.tsx', import.meta.url)
function productionClosure(url: URL, name: string, bindings: Record<string, unknown>, includeHook = false) {
  const source = readFileSync(url, 'utf8')
  const file = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer
      && ts.isCallExpression(node.initializer) && ['useCallback', 'useMemo'].includes(node.initializer.expression.getText(file))) {
      expression = includeHook ? node.initializer : node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!expression) throw new Error(`Actual production closure missing: ${name}`)
  const javascript = ts.transpileModule(`return (${expression.getText(file)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return Function(...Object.keys(bindings), javascript)(...Object.values(bindings))
}

function fixture(multiple = false, initialRequestedWorkspace = 'deleted-workspace') {
  const store = createStore()
  const requestedWorkspaceSlugRef = { current: initialRequestedWorkspace }
  let requestedWorkspaceSlug = requestedWorkspaceSlugRef.current
  const rightSidebarRef = { current: undefined as unknown }
  const writes: unknown[] = [], historyWrites: unknown[] = [], persisted: unknown[] = []
  const reconcile = productionClosure(navURL, 'reconcileFromUrlParams', {
    store, reconcilePanelStackAtom, parseRouteToNavigationState, normalizePanelRouteForReconcile, decodePanelEntries,
    resolveAutoSelectionRef: { current: (state: unknown) => state }, rightSidebarRef, setRightSidebar: () => {},
  })
  const params = new URLSearchParams({ ws: 'deleted-workspace', route: 'notes/note/retained' })
  if (multiple) { params.set('panels', 'home:0.5,notes/note/retained:0.5'); params.set('fi', '0') }
  reconcile(params)
  const navigate = productionClosure(navURL, 'navigate', {
    parseRoute, resolveRouteNavigationState, parseRouteToNavigationStateOrUnavailable: resolveRouteNavigationState, buildRouteFromNavigationState, preserveRouteQuery, isSessionsNavigation, navigationOwnerRef: { current: { active: true, revision: 0 } },
    store, updateFocusedPanelRouteAtom, sessionMetaMapAtom, workspaceId: 'a', remoteWorkspaceId: null,
    workspaceSlug: 'a', requestedWorkspaceSlugRef, setRequestedWorkspaceSlug: (value: string) => { requestedWorkspaceSlug = value },
    isReady: true, isSessionsReady: true, initialRouteRestoredRef: { current: true }, isPopstateSwitchRef: { current: false },
    suppressPushRef: { current: true }, pendingUrlRestoreRef: { current: null },
    historyReconcileRevisionRef: { current: 0 }, historyMountedRef: { current: true }, finishHistoryReconcile: () => {},
    pendingNavigationRef: { current: null }, suppressAutoSelectRef: { current: false }, actionEpochRef: { current: 0 },
    handleActionNavigation: () => { throw new Error('Unexpected action') }, pushPanel: () => { throw new Error('Unexpected panel') },
    resolveAutoSelection: (state: unknown) => state, setNavigationRevision: () => {},
    storage: { KEYS: { lastSelectedSessionId: 'last' }, set: (...args: unknown[]) => persisted.push(args) },
  })
  const readNavigation = () => productionClosure(navURL, 'navigationState', {
    unavailableWorkspaceSlug: requestedWorkspaceSlug !== 'a' ? requestedWorkspaceSlug : null,
    focusedRoute: store.get(focusedPanelRouteAtom), resolveRouteNavigationState, DEFAULT_NAVIGATION_STATE,
    rightSidebar: rightSidebarRef.current, isSessionsNavigation,
    sessionMetaMap: store.get(sessionMetaMapAtom), workspaceId: 'a', remoteWorkspaceId: null,
  })()
  const focusServicePanel = (id: any) => store.set(focusServicePanelAtom, id)
  const serviceNavigate = (route: string) => { writes.push(route); return navigate(route) }
  let retainedCallback: any, retainedDependencies: unknown[] | undefined
  // Evaluate the actual hook expression, including its production dependencies.
  // Keep stable transport/atom callbacks across renders so a missing state dependency is observable.
  const renderClick = () => productionClosure(shellURL, 'handleServiceClick', {
    focusServicePanel, APP_NAV_DESTINATIONS_BY_ID, navState: readNavigation(), navigate: serviceNavigate,
    useCallback: (callback: unknown, dependencies: unknown[]) => {
      if (!retainedDependencies || dependencies.length !== retainedDependencies.length
        || dependencies.some((value, index) => !Object.is(value, retainedDependencies![index]))) {
        retainedCallback = callback
        retainedDependencies = dependencies
      }
      return retainedCallback
    },
  }, true)
  const click = renderClick()
  const syncUrl = productionClosure(navURL, 'syncUrl', {
    requestedWorkspaceSlugRef, workspaceSlug: 'a', store, panelStackAtom, focusedPanelIndexAtom, encodePanelEntries,
    isReady: true, isSessionsReady: true, pendingUrlRestoreRef: { current: null }, previousWorkspaceSlugRef: { current: null },
    historyMountedRef: { current: true }, isPopstateSwitchRef: { current: false },
    window: { location: { href: 'https://fixture.invalid/?ws=deleted-workspace&route=notes%2Fnote%2Fretained' } },
    rightSidebarRef, buildRightSidebarParam,
    nextHistorySeqRef: { current: 1 }, historySeqRef: { current: 0 }, historyMaxSeqRef: { current: 0 },
    updateCanGoBackForward: () => {}, history: { state: {}, pushState: (...args: unknown[]) => historyWrites.push(args), replaceState: (...args: unknown[]) => historyWrites.push(args) },
    storage: { KEYS: { workspaceUrl: 'url' }, set: (...args: unknown[]) => persisted.push(args) },
  })
  const requestWorkspace = (slug: string) => {
    requestedWorkspaceSlugRef.current = slug
    requestedWorkspaceSlug = slug
  }
  return { store, click, renderClick, requestWorkspace, navigate, readNavigation, requestedWorkspaceSlugRef, writes, historyWrites, syncUrl }
}

describe('UI-001 service selection over unavailable workspace — actual composed callbacks', () => {
  for (const multiple of [false, true]) {
    test(`explicit Notes service recovers an unavailable workspace (${multiple ? 'focus another retained panel' : 'already focused retained panel'})`, async () => {
      const f = fixture(multiple)
      expect(f.readNavigation().navigator).toBe('unavailable')
      await f.click('notes')
      f.syncUrl(true)
      expect(f.requestedWorkspaceSlugRef.current).toBe('a')
      expect(f.readNavigation().navigator).toBe('notes')
      expect(f.writes).toEqual(['notes'])
      expect(f.historyWrites).toHaveLength(1)
    })
  }
  test('negative control: direct production navigate performs workspace recovery and actual syncUrl persists it', async () => {
    const f = fixture()
    await f.navigate('notes')
    f.syncUrl(true)
    expect(f.requestedWorkspaceSlugRef.current).toBe('a')
    expect(f.readNavigation().navigator).toBe('notes')
    expect(f.historyWrites).toHaveLength(1)
    expect(String((f.historyWrites[0] as unknown[])[2])).toContain('ws=a')
  })
  test('the actual service hook refreshes its callback when a valid workspace becomes unavailable', async () => {
    const f = fixture(false, 'a')
    const panels = f.store.get(panelStackAtom)
    const focused = f.store.get(focusedPanelIdAtom)
    await f.click('notes')
    expect(f.writes).toEqual([])
    expect(f.store.get(panelStackAtom)).toBe(panels)
    expect(f.store.get(focusedPanelIdAtom)).toBe(focused)
    expect(f.renderClick()).toBe(f.click)

    f.requestWorkspace('deleted-workspace')
    expect(f.readNavigation().navigator).toBe('unavailable')
    const unavailableClick = f.renderClick()
    expect(unavailableClick).not.toBe(f.click)
    await unavailableClick('notes')
    f.syncUrl(true)
    expect(f.writes).toEqual(['notes'])
    expect(f.requestedWorkspaceSlugRef.current).toBe('a')
    expect(f.readNavigation().navigator).toBe('notes')
    expect(f.historyWrites).toHaveLength(1)
  })
})
