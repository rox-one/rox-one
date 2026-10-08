import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createStore } from 'jotai'
import { sessionMetaMapAtom } from '../../atoms/sessions'
import { runtimeMapOpenRequestAtomFamily, runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '../../atoms/runtime-trace'
import { parseRuntimeMapViewRequest } from '../../../shared/runtime-map-link'
import { parseRoute, resolveRouteNavigationState, buildRouteFromNavigationState } from '../../../shared/route-parser'
import { isSessionsNavigation } from '../../../shared/types'
import { preserveRouteQuery } from '../navigation-reconcile'

const source = readFileSync(join(import.meta.dir, '../NavigationContext.tsx'), 'utf8')
const ast = ts.createSourceFile('NavigationContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function actualCallback(name: string, bindings: Record<string, unknown>): Function {
  const matches: ts.VariableDeclaration[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const initializer = matches[0]?.initializer
  if (matches.length !== 1 || !initializer || !ts.isCallExpression(initializer) || !initializer.arguments[0]) throw new Error(`Actual ${name} callback missing/ambiguous`)
  const executable = ts.transpileModule('return (' + initializer.arguments[0].getText(ast) + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
}

function fixture(overrides: { ready?: boolean; restored?: boolean; pendingUrl?: string | null } = {}) {
  const runtimeStore = createStore()
  const requestRuntimeSelection = actualCallback('requestRuntimeSelection', {
    store: runtimeStore, workspaceId: 'workspace-a', parseRuntimeMapViewRequest, runtimeMapOpenRequestAtomFamily, runtimeTraceScopeKey,
  })
  const refs = {
    navigationOwnerRef: { current: { active: true, revision: 0 } },
    isPopstateSwitchRef: { current: false }, suppressPushRef: { current: true },
    historyReconcileRevisionRef: { current: 5 }, suppressAutoSelectRef: { current: false },
    pendingNavigationRef: { current: null as any },
    initialRouteRestoredRef: { current: overrides.restored ?? true },
    pendingUrlRestoreRef: { current: overrides.pendingUrl ?? null },
    requestedWorkspaceSlugRef: { current: 'workspace-a' }, actionEpochRef: { current: 0 },
  }
  const writes: Array<{ route: string; suppressed: boolean; kind: string }> = []
  const observe = (kind: string, route: string) => writes.push({ kind, route, suppressed: refs.suppressPushRef.current })
  const bindings = {
    ...refs, requestRuntimeSelection, isReady: overrides.ready ?? true, isSessionsReady: overrides.ready ?? true,
    workspaceId: 'workspace-a', workspaceSlug: 'workspace-a', parseRoute, resolveRouteNavigationState, buildRouteFromNavigationState,
    setRequestedWorkspaceSlug: () => {},
    isSessionsNavigation, preserveRouteQuery, resolveAutoSelection: (state: unknown) => state,
    handleActionNavigation: async (parsed: { name: string }) => { observe('action', parsed.name) },
    pushPanel: (entry: { route: string }) => observe('panel', entry.route),
    setNavigationRevision: () => {}, updateFocusedPanelRouteAtom: Symbol('opaque atom'),
    store: { get: runtimeStore.get, set: (_atom: unknown, route: string) => observe('route', route) }, sessionMetaMapAtom,
    storage: { KEYS: { lastSelectedSessionId: 'selected' }, set: () => {} },
  }
  const navigate = actualCallback('navigate', bindings) as
    (route: string, options?: { newPanel?: boolean }) => Promise<void>
  return { refs, writes, navigate, runtimeStore }
}

describe('accepted navigation claims actual history before writes', () => {
  test('a runtime map route selects real scoped intent without rewriting recorded execution', async () => {
    const f = fixture(), scope = runtimeTraceScopeKey({ workspaceId: 'workspace-a', sessionId: 'retained' })
    const projection = f.runtimeStore.get(runtimeTraceSessionAtomFamily(scope))
    const route = 'allSessions/session/retained?runtimeRun=run-a&runtimeEvent=event-a'
    await f.navigate(route)
    expect(f.runtimeStore.get(runtimeMapOpenRequestAtomFamily(scope))).toEqual({ rootRunId: 'run-a', eventId: 'event-a', requestId: 1 })
    expect(f.runtimeStore.get(runtimeTraceSessionAtomFamily(scope))).toBe(projection)
    expect(f.runtimeStore.get(runtimeMapOpenRequestAtomFamily(runtimeTraceScopeKey({ workspaceId: 'workspace-b', sessionId: 'retained' })))).toBeUndefined()
    expect(f.writes).toEqual([{ kind: 'route', route, suppressed: false }])
  })
  for (const kind of ['route', 'panel', 'action'] as const) test(`${kind} claims restoration history before its collaborator runs`, async () => {
    const f = fixture()
    await f.navigate(kind === 'action' ? 'action/new-session' : 'sources/source/two', kind === 'panel' ? { newPanel: true } : undefined)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]!.kind).toBe(kind)
    expect(f.writes[0]!.suppressed).toBe(false)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(6)
    expect(f.refs.navigationOwnerRef.current.revision).toBe(1)
  })

  test('not-ready navigation preserves the raw queued route and restoration lease', async () => {
    const f = fixture({ ready: false }); const route = 'sources/source/a%2Fb?fixture=1'
    await f.navigate(route, { newPanel: true })
    expect(f.writes).toEqual([])
    expect(f.refs.pendingNavigationRef.current).toEqual({ route, options: { newPanel: true }, workspaceId: 'workspace-a', owner: f.refs.navigationOwnerRef.current })
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(5)
  })

  test('an incomplete initial restoration queues its exact route without writes and retains suppression', async () => {
    const f = fixture({ restored: false }); const route = 'sources/source/a%2Fb?fixture=1'
    await f.navigate(route)
    expect(f.writes).toEqual([])
    expect(f.refs.pendingNavigationRef.current).toEqual({ route, options: undefined, workspaceId: 'workspace-a', owner: f.refs.navigationOwnerRef.current })
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(5)
  })

  test('a deferred browser restoration retains its URL and lease', async () => {
    const search = '?ws=workspace-a&route=sources%2Fsource%2Fone'
    const f = fixture({ pendingUrl: search }); await f.navigate('sources/source/two')
    expect(f.refs.pendingUrlRestoreRef.current).toBe(search)
    expect(f.writes[0]!.suppressed).toBe(true)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(5)
  })
})
