import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { atom, createStore } from 'jotai'
import type { LoadedProject } from '../../../../../../packages/shared/src/projects/types'

// Execute actual transpiled hook callbacks with controlled render/commit/effect
// phases. The Jotai atom and store are real; only React scheduling and IPC are
// controlled here. This is a closure/lifecycle regression, not a DOM mount.
function evaluate(file: string, modules: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output)(
    (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected runtime import: ${id}`)
      return modules[id]
    }, module, module.exports,
  )
  return module.exports
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function project(workspaceId: string, id: string): LoadedProject {
  return {
    workspaceId, workspaceRootPath: `/fixture/${workspaceId}`,
    folderPath: `/fixture/${workspaceId}/projects/${id}`,
    assetsPath: `/fixture/${workspaceId}/projects/${id}/assets`,
    config: { id, slug: id, name: id, createdAt: 1, updatedAt: 1 },
  }
}

function harness() {
  const { projectsAtom } = evaluate(resolve(import.meta.dir, '../../atoms/projects.ts'), { jotai: { atom } })
  const store = createStore()
  const slots: any[] = []
  let cursor = 0
  let workspace: string | null | undefined
  let result: any
  let mounted = true
  const layouts: (() => void)[] = []
  const effects: (() => void)[] = []
  const requests: { workspaceId: string; pending: ReturnType<typeof deferred<unknown>> }[] = []
  const listeners: { callback: (workspaceId: string, list: unknown) => void; disposed: boolean }[] = []
  const errors: unknown[][] = []
  const writes: unknown[] = []
  const setAtom = (list: LoadedProject[]) => { writes.push(list); store.set(projectsAtom, list) }
  const equal = (a: unknown[], b: unknown[]) => a?.length === b.length && b.every((value, index) => Object.is(a[index], value))
  function memo(factory: () => unknown, deps: unknown[]) {
    const index = cursor++
    if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: factory(), deps }
    return slots[index].value
  }
  function effect(create: () => unknown, deps: unknown[], queue: (() => void)[]) {
    const index = cursor++
    const previous = slots[index]
    if (previous && equal(previous.deps, deps)) return
    const next = { deps, create, queue, cleanup: undefined as any }
    slots[index] = next
    queue.push(() => { previous?.cleanup?.(); next.cleanup = create() })
  }
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++
      if (!slots[index]) {
        const entry = { value: initial, set: undefined as any }
        entry.set = (value: any) => { entry.value = typeof value === 'function' ? value(entry.value) : value }
        slots[index] = entry
      }
      return [slots[index].value, slots[index].set]
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (create: () => unknown, deps: unknown[]) => effect(create, deps, effects),
    useLayoutEffect: (create: () => unknown, deps: unknown[]) => effect(create, deps, layouts),
  }
  const useProjects = evaluate(process.env.ROX_USE_PROJECTS_TEST_SOURCE ?? resolve(import.meta.dir, '../useProjects.ts'), {
    react: hooks, jotai: { useSetAtom: () => setAtom }, '@/atoms/projects': { projectsAtom },
  }).useProjects
  const previousWindow = globalThis.window
  const previousError = console.error
  globalThis.window = { electronAPI: {
    getProjects(workspaceId: string) {
      const pending = deferred<unknown>(); requests.push({ workspaceId, pending }); return pending.promise
    },
    onProjectsChanged(callback: (workspaceId: string, list: unknown) => void) {
      const listener = { callback, disposed: false }; listeners.push(listener)
      return () => { listener.disposed = true }
    },
  } } as any
  console.error = (...args: unknown[]) => errors.push(args)
  const render = (id: string | null | undefined) => {
    workspace = id; cursor = 0; result = useProjects(id)
    while (layouts.length) layouts.shift()!()
    while (effects.length) effects.shift()!()
    return result
  }
  return {
    render, requests, listeners, errors, writes,
    view: () => render(workspace).projects,
    atom: () => store.get(projectsAtom),
    refresh: () => result.refresh(),
    async settle() { await Promise.resolve(); await Promise.resolve() },
    unmount() { for (const slot of slots) slot.cleanup?.(); mounted = false },
    replayEffects() {
      for (const slot of slots) slot.cleanup?.()
      for (const queue of [layouts, effects]) {
        for (const slot of slots) if (slot.queue === queue) slot.cleanup = slot.create()
      }
    },
    close() {
      if (mounted) this.unmount()
      globalThis.window = previousWindow; console.error = previousError
    },
  }
}

describe('useProjects workspace and load generations', () => {
  test('clears A from the atom and returned view at B commit before B RPC completes', async () => {
    const h = harness()
    try {
      h.render('A'); h.requests[0].pending.resolve([project('A', 'a')]); await h.settle()
      expect(h.atom()).toEqual([project('A', 'a')])
      const switched = h.render('B')
      expect(switched.projects).toEqual([])
      expect(h.atom()).toEqual([])
    } finally { h.close() }
  })

  test('late A success cannot overwrite an already loaded B', async () => {
    const h = harness()
    try {
      h.render('A'); h.render('B')
      h.requests[1].pending.resolve([project('B', 'b')]); await h.settle()
      h.requests[0].pending.resolve([project('A', 'a')]); await h.settle()
      expect(h.atom()).toEqual([project('B', 'b')])
      expect(h.view()).toEqual([project('B', 'b')])
    } finally { h.close() }
  })

  test('obsolete A failure neither clears B nor reports a current load error', async () => {
    const h = harness()
    try {
      h.render('A'); h.render('B')
      h.requests[1].pending.resolve([project('B', 'b')]); await h.settle()
      h.requests[0].pending.reject(new Error('old A failure')); await h.settle()
      expect(h.atom()).toEqual([project('B', 'b')])
      expect(h.errors).toEqual([])
    } finally { h.close() }
  })

  test('the newest same-workspace refresh wins over an older load', async () => {
    const h = harness()
    try {
      h.render('A'); const refreshed = h.refresh()
      h.requests[1].pending.resolve([project('A', 'new')]); await refreshed
      h.requests[0].pending.resolve([project('A', 'old')]); await h.settle()
      expect(h.atom()).toEqual([project('A', 'new')])
      expect(h.view()).toEqual([project('A', 'new')])
    } finally { h.close() }
  })

  test('same-workspace broadcast supersedes an older pending query', async () => {
    const h = harness()
    try {
      h.render('A'); h.listeners[0].callback('A', [project('A', 'broadcast')])
      h.requests[0].pending.resolve([project('A', 'old')]); await h.settle()
      expect(h.atom()).toEqual([project('A', 'broadcast')])
      expect(h.view()).toEqual([project('A', 'broadcast')])
    } finally { h.close() }
  })

  test('queued callback from a disposed A subscription cannot alter B', async () => {
    const h = harness()
    try {
      h.render('A'); const old = h.listeners[0]; h.render('B')
      h.requests[1].pending.resolve([project('B', 'b')]); await h.settle()
      old.callback('A', [project('A', 'queued')])
      expect(old.disposed).toBe(true)
      expect(h.atom()).toEqual([project('B', 'b')])
    } finally { h.close() }
  })

  test('an obsolete refresh closure cannot start a request for the old scope', () => {
    const h = harness()
    try {
      const old = h.render('A').refresh; h.render('B'); old()
      expect(h.requests.map(request => request.workspaceId)).toEqual(['A', 'B'])
    } finally { h.close() }
  })

  test('unmount cancels late RPC and queued broadcasts without atom writes', async () => {
    const h = harness()
    try {
      h.render('A'); h.unmount(); const writes = h.writes.length
      h.requests[0].pending.resolve([project('A', 'late')]); await h.settle()
      h.listeners[0].callback('A', [project('A', 'queued')])
      expect(h.writes.length).toBe(writes)
      expect(h.atom()).toEqual([])
    } finally { h.close() }
  })

  test('A-to-B-to-A does not revive the first A lease', async () => {
    const h = harness()
    try {
      h.render('A'); h.render('B'); h.render('A')
      h.requests[2].pending.resolve([project('A', 'current')]); await h.settle()
      h.requests[0].pending.resolve([project('A', 'first')]); await h.settle()
      expect(h.atom()).toEqual([project('A', 'current')])
    } finally { h.close() }
  })

  test('effect replay does not revive callbacks from the disposed subscription', async () => {
    const h = harness()
    try {
      h.render('A'); const disposed = h.listeners[0]; h.replayEffects()
      h.requests[1].pending.resolve([project('A', 'current')]); await h.settle()
      disposed.callback('A', [project('A', 'disposed')])
      h.requests[0].pending.resolve([project('A', 'old-query')]); await h.settle()
      expect(disposed.disposed).toBe(true)
      expect(h.atom()).toEqual([project('A', 'current')])
    } finally { h.close() }
  })

  test('RPC and broadcast payloads retain only current-workspace LoadedProjects', async () => {
    const h = harness()
    try {
      h.render('B')
      h.requests[0].pending.resolve([project('A', 'foreign'), null, project('B', 'allowed')]); await h.settle()
      expect(h.atom()).toEqual([project('B', 'allowed')])
      h.listeners[0].callback('B', [project('A', 'foreign'), project('B', 'updated')])
      expect(h.atom()).toEqual([project('B', 'updated')])
    } finally { h.close() }
  })

  test('null scope clears previous projects and invalidates pending load', async () => {
    const h = harness()
    try {
      h.render('A'); h.requests[0].pending.resolve([project('A', 'a')]); await h.settle()
      const pending = h.refresh(); h.render(null)
      h.requests[1].pending.resolve([project('A', 'late')]); await pending
      expect(h.atom()).toEqual([])
      expect(h.view()).toEqual([])
      expect(h.requests.map(request => request.workspaceId)).toEqual(['A', 'A'])
    } finally { h.close() }
  })

  test('same-workspace success, broadcast and current failure retain their supported behavior', async () => {
    const h = harness()
    try {
      h.render('A'); h.requests[0].pending.resolve([project('A', 'a')]); await h.settle()
      expect(h.view()).toEqual([project('A', 'a')])
      h.listeners[0].callback('foreign', [project('foreign', 'x')])
      expect(h.atom()).toEqual([project('A', 'a')])
      h.listeners[0].callback('A', [project('A', 'changed')])
      expect(h.view()).toEqual([project('A', 'changed')])
      const refresh = h.refresh(); h.requests[1].pending.reject(new Error('current failure')); await refresh
      expect(h.atom()).toEqual([])
      expect(h.errors).toHaveLength(1)
    } finally { h.close() }
  })

  test('retains complete current project metadata without mutating incoming DTO', async () => {
    const h = harness()
    try {
      const rich = { ...project('B', 'rich'), config: { ...project('B', 'rich').config, description: 'Shared context', owner: 'fixture-owner', details: 'retained metadata' } }
      const before = structuredClone(rich)
      h.render('B'); h.requests[0].pending.resolve([rich]); await h.settle()
      expect(h.atom()).toEqual([before])
      expect(rich).toEqual(before)
      h.listeners[0].callback('B', [rich])
      expect(h.view()).toEqual([before])
    } finally { h.close() }
  })
})
