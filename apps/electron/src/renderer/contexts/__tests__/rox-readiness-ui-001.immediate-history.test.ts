import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { parseRoute, parseRouteToNavigationStateOrUnavailable, buildRouteFromNavigationState } from '../../../shared/route-parser'
import { isSessionsNavigation } from '../../../shared/types'
import { preserveRouteQuery } from '../navigation-reconcile'

const source = readFileSync(join(import.meta.dir, '../NavigationContext.tsx'), 'utf8')
const ast = ts.createSourceFile('NavigationContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const matches: ts.VariableDeclaration[] = []
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'navigate') matches.push(node)
  ts.forEachChild(node, visit)
}
visit(ast)
if (matches.length !== 1 || !matches[0]?.initializer || !ts.isCallExpression(matches[0].initializer)) throw new Error('Actual navigate callback missing/ambiguous')
const callback = matches[0].initializer.arguments[0]!
const executable = ts.transpileModule('return (' + callback.getText(ast) + ');', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function fixture(overrides: { ready?: boolean; restored?: boolean; pendingUrl?: string | null } = {}) {
  const refs = {
    navigationOwnerRef: { current: { active: true, revision: 0 } },
    isPopstateSwitchRef: { current: false }, suppressPushRef: { current: true },
    historyReconcileRevisionRef: { current: 5 }, suppressAutoSelectRef: { current: false },
    pendingNavigationRef: { current: null as any },
    initialRouteRestoredRef: { current: overrides.restored ?? true },
    pendingUrlRestoreRef: { current: overrides.pendingUrl ?? null },
  }
  const writes: Array<{ route: string; suppressed: boolean; kind: string }> = []
  const observe = (kind: string, route: string) => writes.push({ kind, route, suppressed: refs.suppressPushRef.current })
  const bindings = {
    ...refs, isReady: overrides.ready ?? true, isSessionsReady: overrides.ready ?? true,
    workspaceId: 'workspace-a', parseRoute, parseRouteToNavigationStateOrUnavailable, buildRouteFromNavigationState,
    isSessionsNavigation, preserveRouteQuery, resolveAutoSelection: (state: unknown) => state,
    handleActionNavigation: async (parsed: { name: string }) => { observe('action', parsed.name) },
    pushPanel: (entry: { route: string }) => observe('panel', entry.route),
    setNavigationRevision: () => {}, updateFocusedPanelRouteAtom: Symbol('opaque atom'),
    store: { set: (_atom: unknown, route: string) => observe('route', route) },
    storage: { KEYS: { lastSelectedSessionId: 'selected' }, set: () => {} },
  }
  const navigate = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as
    (route: string, options?: { newPanel?: boolean }) => Promise<void>
  return { refs, writes, navigate }
}

describe('accepted navigation claims actual history before writes', () => {
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
    expect(f.refs.pendingNavigationRef.current).toEqual({ route, options: { newPanel: true }, owner: f.refs.navigationOwnerRef.current })
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(5)
  })

  test('an incomplete initial restoration retains suppression', async () => {
    const f = fixture({ restored: false }); await f.navigate('sources/source/two')
    expect(f.writes[0]!.suppressed).toBe(true)
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
