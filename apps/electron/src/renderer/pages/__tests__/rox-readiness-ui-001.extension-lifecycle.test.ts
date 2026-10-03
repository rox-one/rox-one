import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../ExtensionSurfacePage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ExtensionSurfacePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExtensionSurfacePage') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual extension component missing')
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
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function fixture(api: Record<string, unknown> = {}) {
  const states: Record<string, unknown> = {}, calls: string[] = []
  const releaseRef = { current: Promise.resolve() }
  let callback: (instanceId: string) => void = () => {}, count = 0
  const nativeApi = {
    createEmbedded: async () => { calls.push('create'); return `instance-${++count}` },
    syncBounds: async ({ instanceId }: { instanceId: string }) => { calls.push(`hide:${instanceId}`) },
    destroy: async ({ instanceId }: { instanceId: string }) => { calls.push(`destroy:${instanceId}`) },
    onRemoved: (listener: typeof callback) => { callback = listener; return () => { calls.push('unsubscribe') } },
    onStateChanged: () => { calls.push('state-subscription'); return () => {} }, ...api,
  }
  const render = (instanceId: string | null = null, surfaceAttempt = 0) => {
    const creates: Array<() => (() => void) | undefined> = []
    const bindings = {
      releaseRef, instanceId, surfaceAttempt, durableKey: 'ext:workspace:extension:view', surfaceUrl: 'about:blank',
      extensionId: 'extension', viewId: 'view', activeWorkspaceId: 'workspace',
      useEffect: (create: () => (() => void) | undefined) => creates.push(create), window: { electronAPI: { extensionSurface: nativeApi } },
      releaseNativeSurface: async (id: string, sync: (id: string, rect: null) => Promise<unknown>) => { await sync(id, null) },
      ...Object.fromEntries(['InstanceId', 'Error', 'Removed'].map(name => [`set${name}`, (value: unknown) => { states[name] = value } ])),
    }
    new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
    return { acquire: creates[0], subscribe: creates[1] }
  }
  return { render, states, calls, releaseRef, notify: (id: string) => callback(id), retainedCallback: () => callback }
}

describe('UI-001 actual extension native owner and removal callbacks', () => {
  test('removal is terminal for the current instance and state broadcasts cannot revive it', async () => {
    const f = fixture(), owner = f.render().acquire()!; await flush()
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
})
