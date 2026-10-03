import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createStore } from 'jotai'
import { runtimeMapOpenRequestAtomFamily, runtimeTraceScopeKey } from '../../atoms/runtime-trace'
import { parseRuntimeMapViewRequest } from '../../../shared/runtime-map-link'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'
import { normalizePanelRouteForReconcile } from '../navigation-reconcile'
import { decodePanelEntries, encodePanelEntries } from '../../lib/panel-url'

// Execute the actual callbacks, without mounting React or introducing an RPC.
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
  const executable = ts.transpileModule(`return (${initializer.arguments[0].getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
}

function fixture(workspaceId: string | null = 'workspace-a') {
  const store = createStore()
  const selection = (sessionId: string, workspace = 'workspace-a') => store.get(runtimeMapOpenRequestAtomFamily(runtimeTraceScopeKey({ workspaceId: workspace, sessionId })))
  const requestRuntimeSelection = actualCallback('requestRuntimeSelection', { store, workspaceId, parseRuntimeMapViewRequest, runtimeMapOpenRequestAtomFamily, runtimeTraceScopeKey })
  const reconciled: Array<{ entries: Array<{ route: string; proportion: number }>; focusedIndex: number }> = []
  const reconcilePanelStackAtom = Symbol('actual stack collaborator')
  const reconcile = actualCallback('reconcileFromUrlParams', {
    routes, requestRuntimeSelection, parseRouteToNavigationState, decodePanelEntries, normalizePanelRouteForReconcile,
    resolveAutoSelectionRef: { current: (state: unknown) => state },
    rightSidebarRef: { current: undefined }, setRightSidebar: () => {}, reconcilePanelStackAtom,
    store: { set: (target: unknown, value: typeof reconciled[number]) => {
      expect(target).toBe(reconcilePanelStackAtom)
      for (const entry of value.entries) {
        const reference = parseRuntimeMapViewRequest(entry.route)
        if (reference && workspaceId) expect(selection(reference.sessionId)?.eventId).toBe(reference.eventId)
      }
      reconciled.push(value)
    } },
  }) as (params: URLSearchParams) => void
  return { store, selection, reconcile, reconciled }
}

const runtimeRoute = (sessionId: string, run = 'run-a', event = 'source:event:1') =>
  `allSessions/session/${sessionId}?${new URLSearchParams({ runtimeRun: run, runtimeEvent: event })}`

describe('actual panel restoration retains read-only runtime references', () => {
  test('panels-only restoration opens every referenced map before its stack is reconciled', () => {
    const f = fixture()
    const entries = [runtimeRoute('first'), 'knowledge/document/a//b?keep=100%25', runtimeRoute('second', 'run-b', 'event,with/slash')]
      .map(route => ({ route, proportion: 1 / 3 }))
    f.reconcile(new URLSearchParams({ panels: encodePanelEntries(entries), fi: '2' }))
    expect(f.selection('first')).toEqual({ rootRunId: 'run-a', eventId: 'source:event:1', requestId: 1 })
    expect(f.selection('second')).toEqual({ rootRunId: 'run-b', eventId: 'event,with/slash', requestId: 1 })
    expect(f.reconciled).toEqual([{ entries, focusedIndex: 2 }])
    expect(f.selection('first', 'workspace-b')).toBeUndefined()
  })

  test('an unfocused runtime panel survives reload and does not rewrite opaque panel addresses', () => {
    const f = fixture()
    const entries = [{ route: runtimeRoute('historic'), proportion: 0.4 }, { route: 'terminal/a//b/?keep=a%2Fb', proportion: 0.6 }]
    f.reconcile(new URLSearchParams({ route: entries[1]!.route, panels: encodePanelEntries(entries), fi: '1' }))
    expect(f.selection('historic')?.eventId).toBe('source:event:1')
    expect(f.reconciled[0]?.entries).toEqual(entries)
  })

  test('corrupt structured panels fall back to the actual route once and reject malformed runtime references', () => {
    const f = fixture()
    f.reconcile(new URLSearchParams({ route: runtimeRoute('fallback'), panels: 'v2:[1]' }))
    expect(f.selection('fallback')?.requestId).toBe(1)
    f.reconcile(new URLSearchParams({ panels: encodePanelEntries([
      { route: 'action/new-session?runtimeRun=run&runtimeEvent=event', proportion: 0.5 },
      { route: 'allSessions/session/invalid?runtimeRun=run&runtimeRun=other&runtimeEvent=event', proportion: 0.5 },
    ]) }))
    expect(f.selection('invalid')).toBeUndefined()
    expect(f.selection('new-session')).toBeUndefined()
  })

  test('a missing workspace cannot create runtime selection in another scope', () => {
    const f = fixture(null)
    f.reconcile(new URLSearchParams({ panels: encodePanelEntries([{ route: runtimeRoute('unscoped'), proportion: 1 }]) }))
    expect(f.selection('unscoped')).toBeUndefined()
  })
})
