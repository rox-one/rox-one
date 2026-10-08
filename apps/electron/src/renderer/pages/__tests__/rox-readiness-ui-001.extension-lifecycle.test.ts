import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { toErrorMessage } from '../../lib/errors'
import ts from 'typescript'

const source = readFileSync(new URL('../ExtensionSurfacePage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ExtensionSurfacePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExtensionSurfacePage') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual extension component missing')
const urlStatement = component.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'surfaceUrl'))
if (!urlStatement) throw new Error('Actual extension URL normalization missing')
const normalizedUrl = new Function('url', ts.transpileModule(`${urlStatement.getText(ast)}; return surfaceUrl`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText) as (url: string | undefined) => string
const effects = component.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'useEffect')
if (effects.length !== 2) throw new Error('Actual extension ownership/subscription effects missing')
const executable = ts.transpileModule(effects.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const enabledRecord = (id = 'extension') => ({
  id, manifest: { id, name: 'Installed test extension', version: '1.0.0', runtime: 'craft-sandbox', permissions: [] },
  category: 'apps', providerId: 'installed', status: 'enabled', worksIn: ['desktop'],
})
const installed = (records: unknown[] = [enabledRecord()], enabled: Record<string, boolean> = {}) => ({ records, state: { version: 1, enabled } })
function fixture(api: Record<string, unknown> = {}, canonicalApi: Record<string, unknown> = {}) {
  const states: Record<string, unknown> = {}, calls: string[] = [], canonicalCalls: unknown[] = [], creations: unknown[] = []
  const releaseRef = { current: Promise.resolve() }
  let callback: (instanceId: string) => void = () => {}, count = 0
  let changed: (payload: { workspaceId?: string; reason: string }) => void = () => {}
  const nativeApi = {
    createEmbedded: async (args: unknown) => { creations.push(args); calls.push('create'); return `instance-${++count}` },
    syncBounds: async ({ instanceId }: { instanceId: string }) => { calls.push(`hide:${instanceId}`) },
    destroy: async ({ instanceId }: { instanceId: string }) => { calls.push(`destroy:${instanceId}`) },
    onRemoved: (listener: typeof callback) => { callback = listener; return () => { calls.push('unsubscribe') } },
    onStateChanged: () => { calls.push('state-subscription'); return () => {} }, ...api,
  }
  const electronAPI = {
    extensionSurface: nativeApi,
    extensionsListInstalled: async (args: unknown) => { canonicalCalls.push(args); return installed() },
    onExtensionsChanged: (listener: typeof changed) => { changed = listener; return () => { canonicalCalls.push('unsubscribe') } },
    ...canonicalApi,
  }
  const render = (instanceId: string | null = null, surfaceAttempt = 0, route: Record<string, unknown> = {}) => {
    const creates: Array<() => (() => void) | undefined> = []
    const selected = { url: 'https://extension.example.test/view' as string | undefined, extensionId: 'extension', viewId: 'view', activeWorkspaceId: 'workspace', ...route }
    const bindings = {
      releaseRef, toErrorMessage, instanceId, surfaceAttempt, durableKey: `ext:${selected.activeWorkspaceId}:${selected.extensionId}:${selected.viewId}`, ...selected, surfaceUrl: normalizedUrl(selected.url),
      useEffect: (create: () => (() => void) | undefined) => creates.push(create), window: { electronAPI },
      releaseNativeSurface: async (id: string, sync: (id: string, rect: null) => Promise<unknown>) => { await sync(id, null) },
      ...Object.fromEntries(['InstanceId', 'Error', 'Removed'].map(name => [`set${name}`, (value: unknown) => { states[name] = value } ])),
    }
    new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
    return { acquire: creates[0], subscribe: creates[1] }
  }
  return {
    render, states, calls, canonicalCalls, creations, releaseRef,
    notify: (id: string) => callback(id), retainedCallback: () => callback,
    notifyChanged: (workspaceId?: string) => changed({ workspaceId, reason: 'refresh' }), retainedChanged: () => changed,
  }
}

describe('UI-001 actual extension native owner and removal callbacks', () => {
  test('removal is terminal for the current instance and state broadcasts cannot revive it', async () => {
    const f = fixture(), owner = f.render().acquire()!; await flush()
    expect(f.canonicalCalls).toEqual([{ workspaceId: 'workspace' }])
    expect(f.creations).toEqual([{ durableKey: 'ext:workspace:extension:view', url: 'https://extension.example.test/view', extensionId: 'extension', viewId: 'view', workspaceId: 'workspace' }])
    const subscription = f.render('instance-1').subscribe()!
    f.notify('other'); expect(f.states.Removed).toBe(false)
    f.notify('instance-1'); expect(f.states.Removed).toBe(true)
    expect(f.calls).not.toContain('state-subscription')
    const queued = f.retainedCallback(); subscription(); f.states.Removed = false
    queued('instance-1'); expect(f.states.Removed).toBe(false)
    owner(); await f.releaseRef.current
    expect(f.calls).toContain('hide:instance-1')
    expect(f.calls).toContain('destroy:instance-1')
  })
  test('Retry waits for old owner hide/destroy before acquiring a fresh instance', async () => {
    const removal = deferred<unknown>(), f = fixture({ destroy: async ({ instanceId }: { instanceId: string }) => {
      f.calls.push(`destroy:${instanceId}`); await removal.promise
    } })
    const dispose = f.render().acquire()!; await flush(); dispose()
    const retryDispose = f.render(null, 1).acquire()!; await flush()
    expect(f.calls.filter(call => call === 'create')).toHaveLength(1)
    removal.resolve(undefined); await flush()
    expect(f.calls).toEqual(['create', 'hide:instance-1', 'destroy:instance-1', 'create'])
    expect(f.states.InstanceId).toBe('instance-2')
    retryDispose(); await f.releaseRef.current
  })
  test('late create after leaving the route is hidden/destroyed without publishing its ID', async () => {
    const creation = deferred<string>(), f = fixture({ createEmbedded: () => creation.promise })
    const dispose = f.render().acquire()!; await flush(); dispose(); creation.resolve('late')
    await f.releaseRef.current
    expect(f.states.InstanceId).toBeNull()
    expect(f.calls).toEqual(['hide:late', 'destroy:late'])
  })
  test('create refusal remains explicit error and cleanup has no unrelated native side effects', async () => {
    const f = fixture({ createEmbedded: async () => { throw new Error('missing extension') } })
    const dispose = f.render().acquire()!; await flush()
    expect(f.states.Error).toBe('missing extension')
    dispose(); await f.releaseRef.current
    expect(f.calls).toEqual([])
  })
  test('unknown selected IDs are unavailable before native creation', async () => {
    const f = fixture({}, { extensionsListInstalled: async () => installed([]) })
    const dispose = f.render(null, 0, { extensionId: 'unknown:raw:id' }).acquire()!; await flush()
    expect(f.states.Error).toBe('extension-missing')
    expect(f.states.InstanceId).toBeNull()
    expect(f.calls).toEqual([])
    dispose(); await f.releaseRef.current
  })
  test('absent, blank, placeholder, and malformed URLs never create an empty native surface', async () => {
    for (const url of [undefined, '', '  ', 'about:blank', 'about:blank#placeholder', 'not an absolute URL']) {
      const f = fixture(), dispose = f.render(null, 0, { url }).acquire()!; await flush()
      expect(f.states.Error).toBe('url-unavailable')
      expect(f.calls).toEqual([])
      dispose(); await f.releaseRef.current
    }
  })
  test('canonical disabled, source-disabled, state-disabled and unsupported runtimes fail closed', async () => {
    const cases = [
      [installed([{ ...enabledRecord(), status: 'disabled' }]), 'extension-disabled'],
      [installed([{ ...enabledRecord(), sourceEnabled: false }]), 'extension-disabled'],
      [installed([enabledRecord()], { extension: false }), 'extension-disabled'],
      [installed([{ ...enabledRecord(), manifest: { ...enabledRecord().manifest, runtime: 'skill-pack' } }]), 'extension-unsupported'],
    ] as const
    for (const [result, reason] of cases) {
      const f = fixture({}, { extensionsListInstalled: async () => result }), dispose = f.render().acquire()!; await flush()
      expect(f.states.Error).toBe(reason)
      expect(f.calls).toEqual([])
      dispose(); await f.releaseRef.current
    }
  })
  test('missing canonical or native capabilities produce explicit unavailable state', async () => {
    for (const f of [fixture({}, { extensionsListInstalled: undefined }), fixture({ createEmbedded: undefined }), fixture({ onRemoved: undefined })]) {
      const dispose = f.render().acquire()!; await flush()
      expect(f.states.Error).toBe('extension-capability-unavailable')
      expect(f.calls).toEqual([])
      dispose(); await f.releaseRef.current
    }
  })
  test('unanswered lookup releases promptly so workspace A→B→A and Retry can progress', async () => {
    const old = deferred<ReturnType<typeof installed>>(); let lookups = 0
    const f = fixture({}, { extensionsListInstalled: async () => ++lookups === 1 ? old.promise : installed() })
    const oldDispose = f.render().acquire()!; const queued = f.retainedChanged(); await flush(); oldDispose()
    const bDispose = f.render(null, 0, { activeWorkspaceId: 'workspace-b' }).acquire()!; await flush()
    expect(f.states.InstanceId).toBe('instance-1'); bDispose(); await f.releaseRef.current
    const nextDispose = f.render(null, 1).acquire()!; await flush()
    expect(f.states.InstanceId).toBe('instance-2')
    const currentCount = lookups; queued({ workspaceId: 'workspace', reason: 'refresh' }); old.resolve(installed([])); await flush()
    expect(lookups).toBe(currentCount)
    expect(f.states.InstanceId).toBe('instance-2')
    expect(f.states.Error).toBeNull()
    nextDispose(); await f.releaseRef.current
  })
  test('new canonical broadcast supersedes an older lookup before it can create', async () => {
    const old = deferred<ReturnType<typeof installed>>(), latest = deferred<ReturnType<typeof installed>>(); let lookups = 0
    const f = fixture({}, { extensionsListInstalled: () => ++lookups === 1 ? old.promise : latest.promise })
    const dispose = f.render().acquire()!; await flush()
    f.notifyChanged('other-workspace'); await flush(); expect(lookups).toBe(1)
    f.notifyChanged('workspace'); await flush(); expect(lookups).toBe(2)
    old.resolve(installed()); await flush(); expect(f.calls).toEqual([])
    latest.resolve(installed([])); await flush()
    expect(f.states.Error).toBe('extension-missing')
    expect(f.calls).toEqual([])
    dispose(); await f.releaseRef.current
  })
  test('removal during native acquisition releases its late lease and valid broadcasts cannot revive it', async () => {
    const creation = deferred<string>(); let lookups = 0
    const f = fixture({ createEmbedded: () => creation.promise }, { extensionsListInstalled: async () => ++lookups === 1 ? installed() : installed([]) })
    const dispose = f.render().acquire()!; await flush()
    f.notifyChanged(); await flush()
    expect(f.states.Error).toBe('extension-missing')
    creation.resolve('late-native'); await f.releaseRef.current
    expect(f.states.InstanceId).toBeNull()
    expect(f.calls).toEqual(['hide:late-native', 'destroy:late-native'])
    f.notifyChanged(); await flush(); expect(lookups).toBe(2)
    dispose(); await f.releaseRef.current
    expect(f.calls).toEqual(['hide:late-native', 'destroy:late-native'])
  })
  test('canonical removal hides/destroys exactly once; unrelated or still-valid changes retain the owner', async () => {
    let available = true, lookups = 0
    const f = fixture({}, { extensionsListInstalled: async () => { lookups++; return installed(available ? [enabledRecord()] : []) } })
    const dispose = f.render().acquire()!; await flush()
    f.notifyChanged('other'); await flush(); expect(lookups).toBe(1)
    f.notifyChanged('workspace'); await flush(); expect(lookups).toBe(2)
    expect(f.calls).toEqual(['create'])
    available = false; f.notifyChanged(); await flush(); await f.releaseRef.current
    expect(f.states.Error).toBe('extension-missing')
    expect(f.calls).toEqual(['create', 'hide:instance-1', 'destroy:instance-1'])
    dispose(); await f.releaseRef.current
    expect(f.calls).toEqual(['create', 'hide:instance-1', 'destroy:instance-1'])
  })
  test('canonical list failures remain unavailable and Retry validates a fresh request', async () => {
    let fail = true
    const f = fixture({}, { extensionsListInstalled: async () => { if (fail) throw new Error('catalog offline'); return installed() } })
    const dispose = f.render().acquire()!; await flush()
    expect(f.states.Error).toBe('catalog offline'); expect(f.calls).toEqual([])
    dispose(); fail = false
    const retryDispose = f.render(null, 1).acquire()!; await flush()
    expect(f.states.Error).toBeNull(); expect(f.states.InstanceId).toBe('instance-1')
    retryDispose(); await f.releaseRef.current
  })

})
