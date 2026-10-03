import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  parseCompoundRoute, parseRoute, parseRouteToNavigationState,
  resolveRouteNavigationState, buildRouteFromNavigationState,
} from '../../../shared/route-parser'
import { isSessionsNavigation, getNavigationStateKey, parseNavigationStateKey } from '../../../shared/types'
import { preserveRouteQuery, normalizePanelRouteForReconcile } from '../navigation-reconcile'
import { rendererEffect as productionRendererEffect, deferred, settle } from '../../components/app-shell/__tests__/rox-readiness-ui-001.effect-harness'

import { decodePanelEntries, encodePanelEntries } from '../../lib/panel-url'
import { focusedPanelIdAtom, focusedPanelRouteAtom } from '../../atoms/panel-stack'

const sourcePath = process.env.ROX_UI001_NAV_SOURCE
  ? pathToFileURL(process.env.ROX_UI001_NAV_SOURCE) : new URL('../NavigationContext.tsx', import.meta.url)
const source = readFileSync(sourcePath, 'utf8')
const file = ts.createSourceFile('NavigationContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const callbacks = new Map<string, string>()

// Supply the merged production lifecycle/codec boundaries without changing any callback body.
function mergedBindings(bindings: Record<string, any>): Record<string, any> {
  const owner = bindings.pendingNavigationRef?.current?.owner ?? { active: true, revision: 0 }
  return { navigationOwnerRef: { current: owner }, decodePanelEntries, encodePanelEntries,
    parseRouteToNavigationStateOrUnavailable: resolveRouteNavigationState,
    isReady: true, isSessionsReady: true, pendingUrlRestoreRef: { current: null },
    previousWorkspaceSlugRef: { current: null }, requestedWorkspaceSlugRef: { current: bindings.workspaceSlug ?? bindings.workspaceId },
    setRequestedWorkspaceSlug: () => {}, suppressAutoSelectRef: { current: false },
    setNavigationRevision: () => {}, focusedPanelIdAtom, focusedPanelRouteAtom, preserveRouteQuery,
    historyReconcileRevisionRef: { current: 0 }, historyMountedRef: { current: true },
    isPopstateSwitchRef: { current: false }, suppressPushRef: { current: false },
    rightSidebarRef: { current: undefined }, finishHistoryReconcile: () => {},
    ...bindings }
}
function rendererEffect(path: URL, text: string, bindings: Record<string, any>) {
  return productionRendererEffect(path, text, mergedBindings(bindings))
}

// Execute production callbacks, replacing only their transport/store boundaries.
function callback(name: string, inputBindings: Record<string, any>) {
  const bindings = mergedBindings(inputBindings)
  if (name === 'handleActionNavigation' && bindings.store && !bindings.store.get) {
    // The atom seam retains the focused target across the actual action's own route commit.
    let route = 'home'
    const originalSet = bindings.store.set
    bindings.store = { ...bindings.store,
      get: (atom: unknown) => atom === focusedPanelIdAtom ? 'fixture' : route,
      set: (atom: unknown, value: unknown) => { if (atom === bindings.updateFocusedPanelRouteAtom) route = String(value); originalSet(atom, value) } }
  }
  const cached = callbacks.get(name)
  if (cached) return Function(...Object.keys(bindings), cached)(...Object.values(bindings))
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'useCallback') {
      expression = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!expression) throw new Error(`Production callback missing: ${name}`)
  const javascript = ts.transpileModule(`return (${expression.getText(file)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  callbacks.set(name, javascript)
  return Function(...Object.keys(bindings), javascript)(...Object.values(bindings))
}

function navigationHarness(ready = true, workspaceId = 'a') {
  const writes: string[] = [], pushed: unknown[] = [], actions: unknown[] = [], persisted: unknown[] = []
  const pendingNavigationRef: { current: any } = { current: null }
  const suppressAutoSelectRef = { current: false }
  const metas = new Map([['own', { id: 'own', workspaceId: 'a' }]])
  const navigate = callback('navigate', {
    actionEpochRef: { current: 0 }, isReady: ready, isSessionsReady: true, initialRouteRestoredRef: { current: true }, isPopstateSwitchRef: { current: false }, workspaceId, remoteWorkspaceId: 'remote-a', pendingNavigationRef, suppressAutoSelectRef,
    workspaceSlug: workspaceId, requestedWorkspaceSlugRef: { current: workspaceId }, setRequestedWorkspaceSlug: () => {},
    parseRoute, resolveRouteNavigationState, parseRouteToNavigationState, buildRouteFromNavigationState,
    isSessionsNavigation, resolveAutoSelection: (state: unknown) => state,
    handleActionNavigation: async (...args: unknown[]) => actions.push(args), pushPanel: (request: unknown) => pushed.push(request),
    store: { get: () => metas, set: (_atom: unknown, route: string) => writes.push(route) },
    sessionMetaMapAtom: {}, updateFocusedPanelRouteAtom: {},
    setNavigationRevision: () => {}, storage: { KEYS: { lastSelectedSessionId: 'last' }, set: (...args: unknown[]) => persisted.push(args) },
  })
  return { navigate, writes, pushed, actions, persisted, pendingNavigationRef, metas }
}

function pendingEffect(bindings: Record<string, any>) {
  // A queued request is created by navigate in production and owns that mounted lifecycle.
  if (bindings.pendingNavigationRef?.current && !bindings.pendingNavigationRef.current.owner) {
    bindings.pendingNavigationRef.current.owner = { active: true, revision: 0 }
  }
  return rendererEffect(sourcePath, 'pendingNavigationRef.current = null', {
    isSessionsReady: true, initialRouteRestoredRef: { current: true }, isPopstateSwitchRef: { current: false },
    requestedWorkspaceSlugRef: { current: bindings.workspaceId }, workspaceSlug: bindings.workspaceId,
    ...bindings,
  })
}

describe('UI-001 address preservation through actual navigation callbacks', () => {
  it('catches a rejected workspace switch, discards its pending action and allows an explicit local recovery', async () => {
    const switched = deferred<boolean>(), errors: string[] = []
    const pendingNavigationRef = { current: { route: 'action/new-session', workspaceId: 'a' } }
    const isPopstateSwitchRef = { current: true }, initialRouteRestoredRef = { current: false }
    const request = callback('requestWorkspaceSwitch', {
      workspaceSwitchRequestRef: { current: 0 }, onSwitchWorkspaceBySlug: () => switched.promise, requestedWorkspaceSlugRef: { current: 'b' },
      pendingNavigationRef, isPopstateSwitchRef, initialRouteRestoredRef, actionEpochRef: { current: 0 },
      toast: { error: (key: string) => errors.push(key) }, t: (key: string) => key,
    })
    expect(request('b')).toBe(true)
    expect(initialRouteRestoredRef.current).toBe(false)
    switched.reject(new Error('Workspace transport disconnected'))
    await settle()
    expect(errors).toEqual(['common.unavailable'])
    expect(pendingNavigationRef.current).toBeNull()
    expect(isPopstateSwitchRef.current).toBe(false)
    expect(initialRouteRestoredRef.current).toBe(true)
    const local = navigationHarness(true)
    await local.navigate('home')
    expect(local.writes).toEqual(['home'])
  })

  it('a rejected same-slug old switch cannot cancel its newer pending request', async () => {
    const old = deferred<boolean>(), latest = deferred<boolean>(), errors: string[] = []
    const pendingNavigationRef = { current: { route: 'home', workspaceId: 'b' } }
    const initialRouteRestoredRef = { current: false }, isPopstateSwitchRef = { current: true }
    let calls = 0
    const request = callback('requestWorkspaceSwitch', {
      workspaceSwitchRequestRef: { current: 0 }, onSwitchWorkspaceBySlug: () => ++calls === 1 ? old.promise : latest.promise,
      requestedWorkspaceSlugRef: { current: 'b' }, pendingNavigationRef, isPopstateSwitchRef, initialRouteRestoredRef,
      actionEpochRef: { current: 0 }, toast: { error: (key: string) => errors.push(key) }, t: (key: string) => key,
    })
    expect(request('b')).toBe(true); expect(request('b')).toBe(true)
    old.reject(new Error('Old B attempt failed'))
    await settle()
    expect(errors).toEqual([])
    expect(pendingNavigationRef.current).toEqual({ route: 'home', workspaceId: 'b' })
    expect(initialRouteRestoredRef.current).toBe(false)
    expect(isPopstateSwitchRef.current).toBe(true)
    latest.reject(new Error('Current B attempt failed')); await settle()
    expect(errors).toEqual(['common.unavailable'])
    expect(pendingNavigationRef.current).toBeNull()
    expect(isPopstateSwitchRef.current).toBe(false)
  })

  it('a rejected obsolete workspace switch cannot cancel the latest workspace request', async () => {
    const switched = deferred<boolean>(), errors: string[] = []
    const pendingNavigationRef = { current: { route: 'home', workspaceId: 'c' } }
    const requestedWorkspaceSlugRef = { current: 'b' }, initialRouteRestoredRef = { current: false }
    const request = callback('requestWorkspaceSwitch', {
      workspaceSwitchRequestRef: { current: 0 }, onSwitchWorkspaceBySlug: () => switched.promise, requestedWorkspaceSlugRef, pendingNavigationRef,
      isPopstateSwitchRef: { current: true }, initialRouteRestoredRef, actionEpochRef: { current: 0 },
      toast: { error: (key: string) => errors.push(key) }, t: (key: string) => key,
    })
    request('b'); requestedWorkspaceSlugRef.current = 'c'
    switched.reject(new Error('old response'))
    await settle()
    expect(errors).toEqual([])
    expect(pendingNavigationRef.current).toEqual({ route: 'home', workspaceId: 'c' })
    expect(initialRouteRestoredRef.current).toBe(false)
  })

  for (const boundary of ['create', 'rename', 'status', 'labels', 'send', 'input']) {
    it(`fences new-session continuation after workspace changes at the ${boundary} boundary`, async () => {
      const blocked = deferred<any>(), writes: unknown[] = [], commands: any[] = [], timers: Array<() => void> = []
      const sends: unknown[] = [], inputs: unknown[] = []
      const workspaceIdRef = { current: 'a' }, actionEpochRef = { current: 1 }
      const action = callback('handleActionNavigation', {
        workspaceId: 'a', workspaceIdRef, actionEpochRef,
        onCreateSession: async () => boundary === 'create' ? blocked.promise : { id: 'created-in-a' },
        window: { electronAPI: {
          sessionCommand: async (id: string, command: any) => {
            commands.push([id, command])
            if ((boundary === 'rename' && command.type === 'rename') ||
                (boundary === 'status' && command.type === 'setSessionStatus') ||
                (boundary === 'labels' && command.type === 'setLabels')) await blocked.promise
          },
          sendMessage: async (...args: unknown[]) => { sends.push(args) },
        } },
        updateSessionMeta: () => {}, pushPanel: (value: unknown) => writes.push(value),
        store: { set: (_atom: unknown, value: unknown) => writes.push(value) }, updateFocusedPanelRouteAtom: {},
        buildRouteFromNavigationState, routes: { view: { allSessions: (id: string) => `allSessions/session/${id}` } },
        onInputChange: (...args: unknown[]) => inputs.push(args), setTimeout: (fn: () => void) => timers.push(fn),
        toast: { error: () => {} }, t: (key: string) => key,
      })
      const promise = action({ name: 'new-session', params: {
        name: 'old', status: 'todo', label: 'label', input: 'hello', send: boundary === 'input' ? 'false' : 'true',
      } })
      await settle()
      const writesBeforeSwitch = writes.length
      workspaceIdRef.current = 'b'
      blocked.resolve({ id: 'created-in-a' })
      await promise
      timers.forEach(fn => fn())
      await settle()
      expect(writes).toHaveLength(writesBeforeSwitch)
      if (!['send', 'input'].includes(boundary)) expect(writes).toEqual([])
      expect(sends).toEqual([])
      expect(inputs).toEqual([])
      if (boundary === 'create') expect(commands).toEqual([])
    })
  }

  it('a newer navigation cancels delayed auto-send, while an unchanged action retains its input behavior', async () => {
    for (const stale of [true, false]) {
      const sends: unknown[] = [], timers: Array<() => void> = [], writes: unknown[] = []
      const actionEpochRef = { current: 1 }
      const action = callback('handleActionNavigation', {
        workspaceId: 'a', workspaceIdRef: { current: 'a' }, actionEpochRef,
        onCreateSession: async () => ({ id: 'new' }), onInputChange: () => {},
        window: { electronAPI: { sendMessage: async (...args: unknown[]) => sends.push(args) } },
        updateSessionMeta: () => {}, pushPanel: () => {}, store: { set: (_atom: unknown, value: unknown) => writes.push(value) },
        updateFocusedPanelRouteAtom: {}, buildRouteFromNavigationState,
        setTimeout: (fn: () => void) => timers.push(fn), toast: { error: () => {} }, t: (key: string) => key,
      })
      await action({ name: 'new-session', params: { input: 'hello', send: 'true' } })
      expect(writes).toEqual(['allSessions/session/new'])
      if (stale) actionEpochRef.current++
      timers.forEach(fn => fn()); await settle()
      expect(sends).toHaveLength(stale ? 0 : 1)
    }
  })

  it('waits for accepted startup workspace restoration and cancels the old action instead of recovering into its old workspace', async () => {
    const waiting = navigationHarness(false), ready = navigationHarness(true)
    await waiting.navigate('action/new-session?name=old-workspace')
    const initialRouteRestoredRef = { current: false }
    const isPopstateSwitchRef = { current: true }
    const requestedWorkspaceSlugRef = { current: 'b' }
    const run = (workspace: string) => pendingEffect({
      isReady: true, workspaceId: workspace, workspaceSlug: workspace, navigate: ready.navigate,
      pendingNavigationRef: waiting.pendingNavigationRef, initialRouteRestoredRef, isPopstateSwitchRef, requestedWorkspaceSlugRef,
    })
    run('a')
    expect(waiting.pendingNavigationRef.current?.workspaceId).toBe('a')
    expect(ready.actions).toEqual([])
    expect(requestedWorkspaceSlugRef.current).toBe('b')
    initialRouteRestoredRef.current = true
    isPopstateSwitchRef.current = false
    run('b')
    expect(waiting.pendingNavigationRef.current).toBeNull()
    expect(ready.actions).toEqual([])
    expect(requestedWorkspaceSlugRef.current).toBe('b')
  })

  it('drops startup actions behind an unavailable workspace URL without rewriting that URL', async () => {
    const waiting = navigationHarness(false), ready = navigationHarness(true)
    await waiting.navigate('action/new-session')
    const requestedWorkspaceSlugRef = { current: 'deleted-workspace' }
    pendingEffect({ isReady: true, workspaceId: 'a', workspaceSlug: 'a', requestedWorkspaceSlugRef,
      pendingNavigationRef: waiting.pendingNavigationRef, navigate: ready.navigate })
    expect(waiting.pendingNavigationRef.current).toBeNull()
    expect(ready.actions).toEqual([])
    expect(requestedWorkspaceSlugRef.current).toBe('deleted-workspace')
  })

  it('view deep links cannot execute recognized action routes even with alternate slash spelling; explicit action links retain parameters', async () => {
    const ready = navigationHarness(true), errors: string[] = []
    let listener!: (nav: any) => void
    rendererEffect(sourcePath, 'onDeepLinkNavigate', {
      workspaceId: 'a', parseRoute, navigate: ready.navigate,
      window: { electronAPI: { onDeepLinkNavigate: (callback: typeof listener) => { listener = callback; return () => {} } } },
      toast: { error: (key: string) => errors.push(key) }, t: (key: string) => key,
    })
    for (const view of ['action/new-session', '/action/new-session', 'action//new-session']) {
      listener({ view })
      await Promise.resolve()
      expect(ready.actions).toEqual([])
    }
    expect(errors).toContain('toast.invalidLink')
    listener({ action: 'new-session', actionParams: { name: 'new', input: 'hello' } })
    await Promise.resolve()
    expect(ready.actions).toEqual([[{ type: 'action', name: 'new-session', id: undefined,
      params: { name: 'new', input: 'hello' } }, undefined]])
  })

  it('retains explicit missing and foreign sessions without asking for an auto-selected replacement', () => {
    let fallbackReads = 0
    const resolve = callback('resolveAutoSelection', {
      isSessionsNavigation, store: { get: () => new Map() }, sessionMetaMapAtom: {}, workspaceId: 'a', remoteWorkspaceId: null,
      getLastSelectedSessionId: () => { fallbackReads++; return 'own' },
      getFirstSessionId: () => { fallbackReads++; return 'own' },
    })
    for (const id of ['missing', 'foreign']) {
      const state = resolveRouteNavigationState(`flagged/session/${id}`)
      expect(resolve(state)).toEqual(state)
    }
    expect(fallbackReads).toBe(0)
    expect(resolve(resolveRouteNavigationState('flagged'))).toMatchObject({ details: { sessionId: 'own' } })
    expect(fallbackReads).toBe(1)
  })

  it('queues the exact filtered/surface address and panel options, then replays once', async () => {
    for (const route of ['knowledge/document/docA', 'knowledge/view/viewA', 'cloud-run/runA', 'extension/extA/viewA',
      'terminal/tA', 'diff/pA', 'flagged/session/own', 'sources/api/source/srcA', 'search?q=a%2Fb']) {
      const waiting = navigationHarness(false), ready = navigationHarness(true)
      const options: any = { newPanel: true, targetLaneId: 'main', skipAutoSelect: true }
      await waiting.navigate(route, options)
      options.newPanel = false
      pendingEffect({
        isReady: true, workspaceId: 'a', pendingNavigationRef: waiting.pendingNavigationRef,
        navigate: ready.navigate, handleActionNavigation: ready.actions.push.bind(ready.actions),
        parseRouteToNavigationState, resolveAutoSelection: (state: unknown) => state,
        buildRouteFromNavigationState, store: { set: (_key: unknown, value: string) => ready.writes.push(value) }, updateFocusedPanelRouteAtom: {},
      })
      expect(ready.pushed).toEqual([{ route, targetLaneId: 'main', intent: 'explicit' }])
      expect(waiting.pendingNavigationRef.current).toBeNull()
      pendingEffect({
        isReady: true, workspaceId: 'a', pendingNavigationRef: waiting.pendingNavigationRef, navigate: ready.navigate,
      })
      expect(ready.pushed).toHaveLength(1)
      expect(ready.actions).toHaveLength(0)
    }
  })

  it('rejects obsolete queued actions after workspace switch and retains query parameters/options for a matching workspace', async () => {
    const waiting = navigationHarness(false), ready = navigationHarness(true)
    const route = 'action/new-session?name=a%2Fb&input=hello&send=true'
    await waiting.navigate(route, { newPanel: true })
    const pending = waiting.pendingNavigationRef.current
    pendingEffect({
      isReady: true, workspaceId: 'b', pendingNavigationRef: waiting.pendingNavigationRef, navigate: ready.navigate,
    })
    expect(ready.actions).toHaveLength(0)
    waiting.pendingNavigationRef.current = pending
    pendingEffect({
      isReady: true, workspaceId: 'a', pendingNavigationRef: waiting.pendingNavigationRef, navigate: ready.navigate,
    })
    await Promise.resolve()
    expect(ready.actions).toEqual([[{ type: 'action', name: 'new-session', id: undefined,
      params: { name: 'a/b', input: 'hello', send: 'true' } }, { newPanel: true }]])
  })

  it('keeps explicit missing/foreign addresses but never persists their session selection', async () => {
    const harness = navigationHarness()
    harness.metas.set('foreign', { id: 'foreign', workspaceId: 'b' })
    for (const route of ['allSessions/session/missing', 'flagged/session/foreign']) await harness.navigate(route)
    expect(harness.writes).toEqual(['allSessions/session/missing', 'flagged/session/foreign'])
    expect(harness.persisted).toEqual([])
    await harness.navigate('allSessions/session/own')
    expect(harness.persisted).toEqual([['last', 'own', 'a']])
  })

  it('reports a failed queued action once and does not automatically repeat its side effects', async () => {
    let attempts = 0
    const errors: unknown[] = []
    const pendingNavigationRef = { current: { route: 'action/new-session', workspaceId: 'a' } }
    pendingEffect({
      isReady: true, workspaceId: 'a', pendingNavigationRef,
      navigate: async () => { attempts++; throw new Error('offline') },
      toast: { error: (message: unknown) => errors.push(message) }, t: (key: string) => key,
    })
    await Promise.resolve(); await Promise.resolve()
    expect(pendingNavigationRef.current).toBeNull()
    expect(attempts).toBe(1)
    expect(errors).toEqual(['common.unavailable'])
  })

  it('restores a malformed single-panel URL to its exact unavailable address instead of leaving the previous panel', () => {
    const writes: any[] = []
    for (const route of ['knowledge/alien/abc', 'allSessions/session', 'cloud-run/%', 'unknown/raw']) {
      callback('reconcileFromUrlParams', {
        store: { set: (_key: unknown, value: unknown) => writes.push(value) }, reconcilePanelStackAtom: {},
        parseRouteToNavigationState, normalizePanelRouteForReconcile, buildRouteFromNavigationState,
        resolveAutoSelectionRef: { current: (state: unknown) => state }, setRightSidebar: () => {},
      })(new URLSearchParams({ route }))
      expect(writes.at(-1)).toEqual({ entries: [{ route, proportion: 1 }], focusedIndex: 0 })
    }
  })

  it('session-selection side effects wait for metadata and reject foreign cached IDs, while permitting the configured remote alias', () => {
    for (const [ready, metaWorkspace, expected] of [[false, 'a', 0], [true, 'b', 0], [true, 'a', 1], [true, 'remote-a', 1]] as const) {
      const selected: unknown[] = [], persisted: unknown[] = []
      rendererEffect(sourcePath, 'setSession({ selected:', {
        navigationState: resolveRouteNavigationState('allSessions/session/s'), isSessionsNavigation,
        isSessionsReady: ready, workspaceId: 'a', remoteWorkspaceId: 'remote-a', setSession: (value: unknown) => selected.push(value),
        sessionMetaMapAtom: {}, store: { get: () => new Map([['s', { workspaceId: metaWorkspace }]]) },
        storage: { KEYS: { lastSelectedSessionId: 'last' }, set: (...args: unknown[]) => persisted.push(args) },
      })
      expect(selected).toHaveLength(expected)
      expect(persisted).toHaveLength(metaWorkspace === 'a' ? expected : 0)
    }
  })

  it('does not rewrite or persist an unresolved workspace address into the current workspace', () => {
    let reads = 0
    const sync = callback('syncUrl', {
      requestedWorkspaceSlugRef: { current: 'deleted-workspace' }, workspaceSlug: 'a',
      store: { get: () => { reads++; throw new Error('Must not canonicalize into current workspace') } },
    })
    expect(() => sync(false)).not.toThrow()
    expect(() => sync(true)).not.toThrow()
    expect(reads).toBe(0)
  })

  it('reload restores an unknown workspace as unavailable and waits for an accepted workspace switch before using its route', () => {
    for (const accepted of [false, true]) {
      const restores: string[] = [], defaults: unknown[] = []
      const initialRouteRestoredRef = { current: false }
      const requestedUrl = 'http://localhost/?ws=deleted-workspace&route=allSessions%2Fsession%2Fforeign'
      rendererEffect(sourcePath, 'canRunInitialRestore({', {
        canRunInitialRestore: () => true, isReady: true, isSessionsReady: true, workspaceId: 'a', workspaceSlug: 'a',
        initialRouteRestoredRef, initialWorkspaceSwitchRef: { current: null }, isPopstateSwitchRef: { current: false },
        onSwitchWorkspaceBySlug: () => accepted, requestWorkspaceSwitch: () => accepted, suppressPushRef: { current: false },
        window: { location: { href: requestedUrl, search: new URL(requestedUrl).search } },
        reconcileFromUrlParamsRef: { current: (params: URLSearchParams) => restores.push(params.toString()) },
        lastSemanticHistoryKeyRef: { current: '' }, getSemanticHistoryKey: () => '',
        navigate: (route: unknown) => defaults.push(route), routes: { view: { allSessions: () => 'allSessions' } },
        history: { replaceState: () => {} }, historySeqRef: { current: 0 }, historyMaxSeqRef: { current: 0 },
        requestAnimationFrame: (fn: () => void) => fn(),
      })
      expect(initialRouteRestoredRef.current).toBe(!accepted)
      expect(restores).toHaveLength(accepted ? 0 : 1)
      expect(defaults).toEqual([])
    }
  })

  it('does not auto-delete a foreign empty session merely because its stale address was closed', () => {
    const deleted: string[] = []
    for (const metaWorkspace of ['b', 'a']) {
      rendererEffect(sourcePath, 'prevVisibleSessionIdsRef.current = currentIds', {
        panelStack: [], parseSessionIdFromRoute: () => null,
        prevVisibleSessionIdsRef: { current: new Set(['empty']) }, onAutoDeleteEmptySession: (id: string) => deleted.push(id),
        sessionMetaMapAtom: {}, store: { get: () => new Map([['empty', { workspaceId: metaWorkspace }]]) },
        workspaceId: 'a', remoteWorkspaceId: 'remote-a', isSessionsReady: true, getDraft: () => '',
      })
    }
    expect(deleted).toEqual(['empty'])
  })
})

describe('UI-001 total route parsing and unavailable history identity', () => {
  for (const route of ['cloud-run/%', 'knowledge/document/%', 'extension/%/v', 'notes/note/%', 'label/%',
    'allSessions/session/%', 'allSessions/session', 'allSessions/unknown/abc', 'knowledge/alien/abc', 'knowledge/view']) {
    it(`recovers ${route}`, () => {
      expect(() => parseCompoundRoute(route)).not.toThrow()
      expect(parseRouteToNavigationState(route)).toBeNull()
      const state = resolveRouteNavigationState(route)
      expect(state).toEqual({ navigator: 'unavailable', route, details: null })
      expect(buildRouteFromNavigationState(state)).toBe(route)
      expect(parseNavigationStateKey(getNavigationStateKey(state))).toEqual(state)
    })
  }
  it('retains surface identity and never turns a restored action into a view capability', () => {
    for (const route of ['knowledge/document/a', 'cloud-run/a', 'extension/a/v', 'diff/a', 'terminal/a']) {
      expect(parseRoute(route)?.name).toBe(route.split('/')[0])
      expect(buildRouteFromNavigationState(resolveRouteNavigationState(route))).toBe(route)
    }
    expect(resolveRouteNavigationState('knowledge')).toMatchObject({ navigator: 'knowledge', details: null })
    expect(resolveRouteNavigationState('action/delete-session/a')).toMatchObject({ navigator: 'unavailable' })
    expect(parseRoute('action/delete-session/a')).toMatchObject({ type: 'action', name: 'delete-session' })
  })
})
