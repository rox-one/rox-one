import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Execute the production history callbacks and committed layout effects. Only
// browser URL, readiness, refs and external collaborators are controlled here.
// This is callback/lease proof, not installed/native acceptance.
const source = readFileSync(join(import.meta.dir, '../NavigationContext.tsx'), 'utf8')
const ast = ts.createSourceFile('NavigationContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = (name: string) => {
  const matches: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (matches.length !== 1 || !matches[0]?.initializer) throw new Error('Production callback missing/ambiguous: ' + name)
  return matches[0]!.initializer!
}
const callback = (name: string) => {
  const value = declaration(name)
  const expression = ts.isCallExpression(value) ? value.arguments[0] : value
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))) {
    throw new Error('Production callback is not executable: ' + name)
  }
  return `const ${name} = ${expression.getText(ast)};`
}
const provider = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NavigationProvider') as ts.FunctionDeclaration | undefined
if (!provider?.body) throw new Error('Production NavigationProvider missing')
const layoutEffects = provider.body.statements.filter(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression)
  && ((ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'useLayoutEffect')
    || (ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'useLayoutEffect')))
const executable = ts.transpileModule(layoutEffects.map(node => node.getText(ast)).join('\n')
  + '\n' + callback('finishHistoryReconcile') + '\n' + callback('handlePopState')
  + '\nreturn { handlePopState, finishHistoryReconcile };',
{ compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
console.info(JSON.stringify({ productionSourceSha256: createHash('sha256').update(source).digest('hex'),
  productionLayoutEffectCount: layoutEffects.length,
  workspaceHistoryLayoutPresent: layoutEffects.some(node => node.getText(ast).includes('historyReconcileRevisionRef')) }))

const deferred = () => {
  let resolve!: (value: boolean) => void, reject!: (error: unknown) => void
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
type Scope = { workspaceId: string; workspaceSlug: string; remoteWorkspaceId: string; isReady: boolean; isSessionsReady: boolean }
type Effect = { create: () => void | (() => void); deps: unknown[]; cleanup?: () => void }
function fixture() {
  const refs = {
    navigationOwnerRef: { current: { active: true, revision: 0 } },
    suppressAutoSelectRef: { current: false },
    historyReconcileRevisionRef: { current: 0 }, historyMountedRef: { current: true },
    historySeqRef: { current: 0 }, isPopstateSwitchRef: { current: false },
    suppressPushRef: { current: false }, pendingUrlRestoreRef: { current: null as string | null },
    lastSemanticHistoryKeyRef: { current: '' },
    initialRouteRestoredRef: { current: false },
  }
  let scope: Scope = { workspaceId: 'workspace-a', workspaceSlug: 'alpha', remoteWorkspaceId: 'remote-a', isReady: true, isSessionsReady: true }
  const browser = { location: { search: '?ws=alpha&route=notes%2Fnote%2Finitial' } }
  let focusedRoute = 'notes/note/initial', seq = 0
  const switches: Array<{ slug: string; pending: ReturnType<typeof deferred> }> = []
  const syncs: Array<{ push: boolean; search: string }> = [], reconciles: string[] = [], warnings: unknown[][] = []
  const frames: Array<() => void> = []
  const historyPushes: Array<{ route: string }> = []
  let committedEffects: Effect[] = []
  let functions!: { handlePopState(event: { state: { seq: number } }): void; finishHistoryReconcile(): void }
  const commit = (update: Partial<Scope> = {}) => {
    scope = { ...scope, ...update }
    const registered: Effect[] = []
    const layout = (create: Effect['create'], deps: unknown[]) => { registered.push({ create, deps }) }
    const bindings = { ...refs, ...scope,
      useLayoutEffect: layout, React: { useLayoutEffect: layout },
      window: browser, requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length },
      updateCanGoBackForward: () => {},
      onSwitchWorkspaceBySlug: (slug: string) => { const pending = deferred(); switches.push({ slug, pending }); return pending.promise },
      getSemanticHistoryKey: () => JSON.stringify([scope.workspaceSlug, focusedRoute]),
      syncUrl: (push: boolean) => {
        browser.location.search = '?' + new URLSearchParams({ ws: scope.workspaceSlug, route: focusedRoute })
        syncs.push({ push, search: browser.location.search })
      },
      maybePushHistoryForSemanticChange: () => { historyPushes.push({ route: focusedRoute }) },
      reconcileFromUrlParamsRef: { current: (params: URLSearchParams) => {
        focusedRoute = params.get('route') ?? 'allSessions'; reconciles.push(params.toString())
      } },
      console: { warn: (...args: unknown[]) => { warnings.push(args) } },
    }
    functions = new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
    const changed = registered.map((effect, i) => !committedEffects[i]
      || effect.deps.length !== committedEffects[i]!.deps.length
      || effect.deps.some((value, n) => !Object.is(value, committedEffects[i]!.deps[n])))
    changed.forEach((value, i) => { if (value) committedEffects[i]?.cleanup?.() })
    registered.forEach((effect, i) => {
      if (!changed[i]) { effect.cleanup = committedEffects[i]?.cleanup; return }
      const cleanup = effect.create(); if (typeof cleanup === 'function') effect.cleanup = cleanup
    })
    committedEffects = registered
  }
  commit()
  return {
    refs, browser, switches, syncs, reconciles, warnings, commit, historyPushes,
    pop(search: string) { browser.location.search = search; functions.handlePopState({ state: { seq: ++seq } }) },
    focus(route: string) { focusedRoute = route; refs.navigationOwnerRef.current.revision++ },
    flushFrames() { while (frames.length) frames.shift()!() },
    // Commit-time layout disposal precedes the passive history-mounted cleanup.
    disposeLayout() { committedEffects.forEach(effect => effect.cleanup?.()) },
    // React StrictMode replays layout setup after the first passive cleanup.
    replayLayout() {
      committedEffects.forEach(effect => effect.cleanup?.())
      refs.historyMountedRef.current = false
      committedEffects.forEach(effect => {
        const cleanup = effect.create()
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
      refs.historyMountedRef.current = true
    },
  }
}

describe('actual popstate failed-switch history lease', () => {
  for (const outcome of ['false', 'reject'] as const) test(`focus intent change still releases its own ${outcome} switch and restores current URL`, async () => {
    const f = fixture(); f.pop('?ws=bravo&route=notes%2Fnote%2Fforeign')
    const lease = f.refs.historyReconcileRevisionRef.current
    f.focus('notes/note/current-focus')
    expect(f.refs.historyReconcileRevisionRef.current).toBe(lease)
    if (outcome === 'reject') f.switches[0]!.pending.reject(new Error('Unavailable workspace'))
    else f.switches[0]!.pending.resolve(false)
    await settle()
    expect(f.refs.isPopstateSwitchRef.current).toBe(false)
    expect(f.refs.suppressPushRef.current).toBe(false)
    expect(f.syncs).toEqual([{ push: false, search: '?ws=alpha&route=notes%2Fnote%2Fcurrent-focus' }])
  })

  test('remote-only action-owner rotation does not abandon the same local-workspace history lease', async () => {
    const f = fixture(); f.pop('?ws=bravo&route=allSessions')
    const lease = f.refs.historyReconcileRevisionRef.current, owner = f.refs.navigationOwnerRef.current
    f.commit({ remoteWorkspaceId: 'remote-b' })
    expect(f.refs.navigationOwnerRef.current).not.toBe(owner)
    expect(f.refs.historyReconcileRevisionRef.current).toBe(lease)
    f.switches[0]!.pending.resolve(false); await settle()
    expect(f.refs.isPopstateSwitchRef.current).toBe(false)
    expect(f.refs.suppressPushRef.current).toBe(false)
    expect(f.syncs).toHaveLength(1)
    expect(f.browser.location.search).toBe('?ws=alpha&route=notes%2Fnote%2Finitial')
  })

  test('newer cross-workspace history, local-workspace ABA while not ready, and layout disposal fence old failures', async () => {
    const f = fixture(); f.pop('?ws=bravo&route=allSessions'); f.pop('?ws=charlie&route=notes')
    f.switches[0]!.pending.reject(new Error('Older failure')); await settle()
    expect(f.refs.isPopstateSwitchRef.current).toBe(true); expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.syncs).toEqual([]); expect(f.browser.location.search).toBe('?ws=charlie&route=notes')
    f.switches[1]!.pending.resolve(false); await settle()
    expect(f.refs.isPopstateSwitchRef.current).toBe(false); expect(f.syncs).toHaveLength(1)
    for (const mode of ['workspace-ABA', 'layout-disposal'] as const) {
      const stale = fixture(); stale.pop('?ws=bravo&route=allSessions')
      if (mode === 'workspace-ABA') {
        stale.commit({ workspaceId: 'workspace-b', workspaceSlug: 'bravo', isReady: false })
        stale.commit({ workspaceId: 'workspace-a', workspaceSlug: 'alpha', isReady: false })
      } else {
        stale.disposeLayout()
        expect(stale.refs.historyMountedRef.current).toBe(true)
      }
      stale.switches[0]!.pending.resolve(false); await settle()
      expect(stale.syncs).toEqual([]); expect(stale.refs.suppressPushRef.current).toBe(true)
    }
  })

  test('new same-workspace Back cancels the previous cross-switch flag and reconciles its own URL', async () => {
    const f = fixture(); f.pop('?ws=bravo&route=allSessions')
    f.pop('?ws=alpha&route=notes%2Fnote%2Fback-target')
    expect(f.refs.isPopstateSwitchRef.current).toBe(false)
    expect(f.reconciles).toEqual(['ws=alpha&route=notes%2Fnote%2Fback-target'])
    f.flushFrames(); expect(f.refs.suppressPushRef.current).toBe(false)
    f.switches[0]!.pending.resolve(false); await settle()
    expect(f.syncs).toEqual([]); expect(f.browser.location.search).toBe('?ws=alpha&route=notes%2Fnote%2Fback-target')
  })

  test('same-workspace history received before metadata readiness immediately owns a new lease', async () => {
    const f = fixture(); f.pop('?ws=bravo&route=allSessions')
    const oldLease = f.refs.historyReconcileRevisionRef.current
    f.commit({ isReady: false }); const search = '?ws=alpha&route=notes%2Fnote%2Fpending'
    f.pop(search)
    expect(f.refs.historyReconcileRevisionRef.current).toBeGreaterThan(oldLease)
    expect(f.refs.isPopstateSwitchRef.current).toBe(false)
    expect(f.refs.pendingUrlRestoreRef.current).toBe(search)
    f.switches[0]!.pending.reject(new Error('Superseded failure')); await settle()
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.syncs).toEqual([]); expect(f.browser.location.search).toBe(search)
  })

  test('an older reconciliation frame cannot release a newer readiness-deferred popstate', () => {
    const f = fixture(); f.pop('?ws=alpha&route=notes%2Fnote%2Ffirst')
    f.commit({ isSessionsReady: false }); f.pop('?ws=alpha&route=notes%2Fnote%2Fsecond')
    f.flushFrames()
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.refs.pendingUrlRestoreRef.current).toBe('?ws=alpha&route=notes%2Fnote%2Fsecond')
  })

  test('successful async workspace switch leaves suppression to the workspace restoration owner', async () => {
    const f = fixture(); f.pop('?ws=bravo&route=allSessions')
    expect(f.switches[0]!.slug).toBe('bravo')
    f.switches[0]!.pending.resolve(true); await settle()
    expect(f.refs.isPopstateSwitchRef.current).toBe(true)
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.syncs).toEqual([]); expect(f.reconciles).toEqual([])
  })

  test('StrictMode layout replay resumes restoration and preserves navigation before its frame', () => {
    const f = fixture(); f.refs.initialRouteRestoredRef.current = true
    f.pop('?ws=alpha&route=notes%2Fnote%2Frestored')
    const semanticKey = f.refs.lastSemanticHistoryKeyRef.current
    f.replayLayout(); f.focus('notes/note/explicit-after-replay')
    expect(f.refs.lastSemanticHistoryKeyRef.current).toBe(semanticKey)
    expect(f.refs.suppressPushRef.current).toBe(true)
    f.flushFrames()
    expect(f.refs.suppressPushRef.current).toBe(false)
    expect(f.historyPushes).toEqual([{ route: 'notes/note/explicit-after-replay' }])
  })

  test('StrictMode replay does not release an active cross-workspace history switch', () => {
    const f = fixture(); f.refs.initialRouteRestoredRef.current = true
    f.pop('?ws=bravo&route=notes%2Fnote%2Fforeign'); f.replayLayout(); f.flushFrames()
    expect(f.refs.isPopstateSwitchRef.current).toBe(true)
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.historyPushes).toEqual([])
  })

  test('StrictMode replay does not release readiness-deferred history restoration', () => {
    const f = fixture(); f.refs.initialRouteRestoredRef.current = true
    f.commit({ isReady: false }); const search = '?ws=alpha&route=notes%2Fnote%2Fpending'
    f.pop(search); f.replayLayout(); f.flushFrames()
    expect(f.refs.pendingUrlRestoreRef.current).toBe(search)
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.historyPushes).toEqual([])
  })

  test('disposing a replayed layout lease fences both the original and replacement frames', () => {
    const f = fixture(); f.refs.initialRouteRestoredRef.current = true
    f.pop('?ws=alpha&route=notes%2Fnote%2Frestored'); f.replayLayout()
    f.disposeLayout(); f.refs.historyMountedRef.current = false; f.flushFrames()
    expect(f.refs.suppressPushRef.current).toBe(true)
    expect(f.historyPushes).toEqual([])
  })

  test('a completed restoration does not synthesize another release during replay', () => {
    const f = fixture(); f.refs.initialRouteRestoredRef.current = true
    f.replayLayout(); f.flushFrames()
    expect(f.refs.suppressPushRef.current).toBe(false)
    expect(f.historyPushes).toEqual([])
  })
})
