import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual PageView hooks with controlled commits and RPC timing.
// This fixture proves renderer ownership; it is not backend authorization proof.
const source = readFileSync(new URL('../PageView.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('PageView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ScopedPageView') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual scoped PageView component missing')
const end = component.body.statements.findIndex(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast).includes('confirmingDelete')))
if (end < 0) throw new Error('Actual PageView lifecycle boundary missing')
const executable = ts.transpileModule(component.body.statements.slice(0, end).map(node => node.getText(ast)).join('\n')
  + '\nreturn { page, fallbackResolved, currentLease, currentLeaseError, snapshotReady, snapshotState };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const page = (workspaceId = 'a', digest = 'digest-1') => ({
  workspaceId, workspaceRootPath: `/${workspaceId}`, config: { slug: 'shared', name: workspaceId, contentDigest: digest, updatedAt: 1 },
})
const lease = (digest = 'digest-1', leaseId = 'lease-1') => ({
  lease: { leaseId, pageSlug: 'shared', contentDigest: digest, nonce: 'fixture-nonce', issuedAt: 1, expiresAt: 100 }, content: '<p>fixture</p>',
})

function fixture(api: Record<string, unknown> = {}) {
  const states: unknown[] = []
  const effects: Array<{ deps: unknown[]; dispose?: () => void }> = []
  let stateCursor = 0
  let pending: Array<{ create: () => (() => void) | undefined; deps: unknown[] }> = []
  const releases: Array<[string, string]> = []
  const actualApi = {
    getPage: async () => null, createPageLease: async () => lease(), getPageData: async () => ({ value: 1 }),
    releasePageLease: async (workspaceId: string, leaseId: string) => { releases.push([workspaceId, leaseId]) }, ...api,
  }
  const React = {
    useMemo: (fn: () => unknown) => fn(),
    useState(initial: unknown) {
      const slot = stateCursor++
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [states[slot], (value: unknown) => { states[slot] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(states[slot]) : value }]
    },
    useEffect(create: () => (() => void) | undefined, deps: unknown[]) { pending.push({ create, deps }) },
  }
  const run = new Function('React', 'useAppShellContext', 'useTranslation', 'useNavigation', 'useAtomValue', 'pagesAtom', 'window', 'pageSlug', executable)
  const render = (workspaceId: string | null, pages: ReturnType<typeof page>[] = []) => {
    stateCursor = 0; pending = []
    const value = run(React, () => ({ activeWorkspaceId: workspaceId, workspaces: workspaceId ? [{ id: workspaceId, rootPath: `/${workspaceId}` }] : [] }),
      () => ({ t: (key: string) => key }), () => ({ navigate: () => {} }), () => pages, {}, { electronAPI: actualApi }, 'shared')
    const scheduled = pending
    return {
      ...value,
      commit() {
        scheduled.forEach(({ create, deps }, index) => {
          const previous = effects[index]
          if (previous && previous.deps.length === deps.length && deps.every((value, slot) => Object.is(value, previous.deps[slot]))) return
          previous?.dispose?.()
          effects[index] = { deps, dispose: create() }
        })
      },
    }
  }
  return { render, releases, dispose: () => { effects.forEach(effect => effect.dispose?.()) } }
}

describe('UI-001 actual PageView fallback, lease and snapshot lifecycle', () => {
  test('retains valid atom page and binds lease and data to the requested workspace', async () => {
    const f = fixture(), pages = [page()]
    f.render('a', pages).commit(); await flush()
    const view = f.render('a', pages)
    expect(view.page).toBe(pages[0])
    expect(view.currentLease.workspaceId).toBe('a')
    expect(view.snapshotReady).toBe(true)
    expect(view.snapshotState.data).toEqual({ value: 1 })
    f.dispose(); await flush()
    expect(f.releases).toEqual([['a', 'lease-1']])
  })
  test('does not display a foreign workspace atom or carry old lease/snapshot across same-slug switch', async () => {
    const f = fixture(), pages = [page()]
    f.render('a', pages).commit(); await flush()
    const switched = f.render('b', pages)
    expect(switched.page).toBeNull()
    expect(switched.currentLease).toBeNull()
    expect(switched.snapshotReady).toBe(false)
    switched.commit(); await flush()
    f.dispose()
    expect(f.releases).toEqual([['a', 'lease-1']])
  })
  test('a new list invalidates old deep-link fallback immediately and late read cannot revive deletion', async () => {
    const old = deferred<ReturnType<typeof page> | null>(), newer = deferred<ReturnType<typeof page> | null>()
    let calls = 0
    const f = fixture({ getPage: () => ++calls === 1 ? old.promise : newer.promise }), initial: ReturnType<typeof page>[] = []
    f.render('a', initial).commit()
    const deleted: ReturnType<typeof page>[] = []
    f.render('a', deleted).commit()
    newer.resolve(null); await flush(); old.resolve(page()); await flush()
    const view = f.render('a', deleted)
    expect(view.page).toBeNull()
    expect(view.fallbackResolved).toBe(true)
    f.dispose()
  })
  test('successful fallback is hidden on list change and failed replacement is resolved unavailable', async () => {
    const replacement = deferred<ReturnType<typeof page> | null>(); let calls = 0
    const f = fixture({ getPage: () => ++calls === 1 ? Promise.resolve(page()) : replacement.promise })
    const initial: ReturnType<typeof page>[] = []
    f.render('a', initial).commit(); await flush()
    expect(f.render('a', initial).page?.config.name).toBe('a')
    const changed: ReturnType<typeof page>[] = []
    const next = f.render('a', changed)
    expect(next.page).toBeNull()
    expect(next.fallbackResolved).toBe(false)
    next.commit(); replacement.reject(new Error('denied')); await flush()
    expect(f.render('a', changed).fallbackResolved).toBe(true)
    expect(f.render('a', changed).page).toBeNull()
    f.dispose()
  })
  test('late lease after disposal is released and cannot publish', async () => {
    const acquisition = deferred<ReturnType<typeof lease>>(), f = fixture({ createPageLease: () => acquisition.promise }), pages = [page()]
    f.render('a', pages).commit(); f.dispose()
    acquisition.resolve(lease()); await flush()
    expect(f.render('a', pages).currentLease).toBeNull()
    expect(f.releases).toEqual([['a', 'lease-1']])
  })
  test('content digest change hides stale lease and snapshot before the next commit', async () => {
    const acquisition = deferred<ReturnType<typeof lease>>(); let calls = 0
    const f = fixture({ createPageLease: () => ++calls === 1 ? Promise.resolve(lease()) : acquisition.promise })
    const first = [page()]
    f.render('a', first).commit(); await flush()
    const changed = [page('a', 'digest-2')], next = f.render('a', changed)
    expect(next.currentLease).toBeNull()
    expect(next.snapshotReady).toBe(false)
    next.commit(); acquisition.resolve(lease('digest-2', 'lease-2')); await flush()
    expect(f.render('a', changed).currentLease.lease.leaseId).toBe('lease-2')
    f.dispose(); await flush()
    expect(f.releases).toEqual([['a', 'lease-1'], ['a', 'lease-2']])
  })
  test('snapshot revision change hides old data and late prior snapshot cannot replace the latest', async () => {
    const old = deferred<unknown>(), next = deferred<unknown>(); let calls = 0
    const f = fixture({ getPageData: () => ++calls === 1 ? old.promise : next.promise }), first = [page()]
    f.render('a', first).commit()
    const changed = [{ ...page(), config: { ...page().config, updatedAt: 2 } }]
    expect(f.render('a', changed).snapshotReady).toBe(false)
    f.render('a', changed).commit(); next.resolve({ value: 2 }); await flush(); old.resolve({ value: 1 }); await flush()
    expect(f.render('a', changed).snapshotState.data).toEqual({ value: 2 })
    f.dispose()
  })
  test('no selected workspace resolves instead of leaving an infinite loading placeholder', () => {
    const f = fixture(), view = f.render(null)
    expect(view.page).toBeNull()
    expect(view.fallbackResolved).toBe(true)
    view.commit(); f.dispose()
  })
})
