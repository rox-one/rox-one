import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { createStore } from 'jotai'
import {
  activeBrowserInstanceIdAtom, browserInstancesAtom, filterInstancesForWorkspace,
  removeBrowserInstanceAtom, setBrowserInstancesAtom, updateBrowserInstanceAtom,
} from '../../../atoms/browser-pane'
import { resolveWorkbenchChrome } from '../../../platform/workbench-chrome'

const directory = resolve(import.meta.dir, '..')
function declaration(path: string, name: string) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  if (!fn) throw new Error(`Missing ${name}`)
  return fn.getText(source).replace(/^export\s+/, '')
}
function evaluate(path: string, name: string, bindings: Record<string, unknown>) {
  const output = ts.transpileModule(declaration(path, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return new Function(...Object.keys(bindings), `${output}\nreturn ${name};`)(...Object.values(bindings))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve() }
function instance(id: string) { return { id, title: id, url: 'https://example.com', workspaceId: 'ws', embedded: false } as any }

/** Execute the delivered component and hook; replace scheduling and IPC only. */
function harness() {
  const store = createStore()
  const slots: any[] = []
  let cursor = 0
  const callbacks: Record<string, (value: any) => void> = {}
  const timers = new Map<number, () => void>()
  let timerId = 0
  let listCalls = 0
  let cleanupCalls = 0
  let listResult = Promise.resolve<any[]>([])
  const atomSetters = new Map<any, any>()
  const setter = (atom: any) => {
    if (!atomSetters.has(atom)) atomSetters.set(atom, (value: any) => store.set(atom, value))
    return atomSetters.get(atom)
  }
  const api = {
    list: () => { listCalls++; return listResult },
    onStateChanged: (fn: (value: any) => void) => subscribe('state', fn),
    onRemoved: (fn: (value: any) => void) => subscribe('removed', fn),
    onInteracted: (fn: (value: any) => void) => subscribe('interacted', fn),
  }
  function subscribe(name: string, fn: (value: any) => void) {
    callbacks[name] = fn
    return () => { cleanupCalls++; delete callbacks[name] }
  }
  const hook = evaluate(resolve(directory, 'use-workspace-browser-windows.ts'), 'useWorkspaceBrowserWindows', {
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (value: unknown) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }) },
    useEffect: (create: () => (() => void) | void, deps: unknown[]) => {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        previous?.cleanup?.()
        slots[index] = { deps, cleanup: create() }
      }
    },
    useAtomValue: (atom: any) => store.get(atom),
    useSetAtom: setter,
    useAtom: (atom: any) => [store.get(atom), setter(atom)],
    useAppShellContext: () => ({ activeWorkspaceId: 'ws', workspaces: [{ id: 'ws' }] }),
    window: { electronAPI: { browserPane: api, isChannelAvailable: () => true } },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId },
    clearTimeout: (id: number) => timers.delete(id),
    activeBrowserInstanceIdAtom, browserInstancesAtom, filterInstancesForWorkspace,
    removeBrowserInstanceAtom, setBrowserInstancesAtom, updateBrowserInstanceAtom,
  })
  const registry = evaluate(resolve(directory, 'WorkspaceBrowserRegistry.tsx'), 'WorkspaceBrowserRegistry', {
    useWorkspaceBrowserWindows: hook,
  })
  return {
    store, callbacks, timers,
    render(enabled = true) { cursor = 0; expect(registry({ enabled })).toBeNull() },
    setList(promise: Promise<any[]>) { listResult = promise },
    get listCalls() { return listCalls }, get cleanupCalls() { return cleanupCalls },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
    runTimers() { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } },
  }
}

describe('shell browser registry lifecycle', () => {
  it('keeps list, state, interaction and removal current while the strip is hidden', async () => {
    const chrome = resolveWorkbenchChrome({ unifiedShell: false, topChrome: false, tabGroups: false, browserSurface: true, harnessInspector: false, modeRegistry: false, statusBar: false })
    expect(chrome.hideBrowserTabStrip).toBe(true)
    const h = harness()
    h.setList(Promise.resolve([instance('a'), instance('b')]))
    h.render(chrome.hideBrowserTabStrip)
    await flush(); h.render(true)
    expect(h.store.get(browserInstancesAtom).map(info => info.id)).toEqual(['a', 'b'])
    h.callbacks.state!({ ...instance('a'), title: 'Changed', agentControlActive: true, isVisible: true })
    expect(h.store.get(browserInstancesAtom)[0]?.title).toBe('Changed')
    h.callbacks.interacted!('b')
    expect(h.store.get(activeBrowserInstanceIdAtom)).toBe('b')
    h.callbacks.removed!('b')
    expect(h.store.get(activeBrowserInstanceIdAtom)).toBe('a')
    h.setList(Promise.resolve([instance('a')]))
    h.runTimers(); await flush()
    expect(h.listCalls).toBe(2)
    expect(h.store.get(browserInstancesAtom).map(info => info.id)).toEqual(['a'])
    h.unmount()
    expect(h.cleanupCalls).toBe(3)
  })

  it('relinquishes subscriptions to the visible strip and discards late results', async () => {
    const h = harness()
    const pending = deferred<any[]>()
    h.setList(pending.promise)
    h.render(true)
    h.callbacks.removed!('a')
    const lateState = h.callbacks.state!
    h.render(false)
    expect(h.cleanupCalls).toBe(3)
    expect(h.timers.size).toBe(0)
    pending.resolve([instance('late')]); lateState(instance('late'))
    await flush()
    expect(h.store.get(browserInstancesAtom)).toEqual([])
    expect(h.listCalls).toBe(1)
    h.setList(Promise.resolve([instance('reopened')]))
    h.render(true); await flush()
    expect(h.store.get(browserInstancesAtom)[0]?.id).toBe('reopened')
    expect(Object.keys(h.callbacks)).toHaveLength(3)
    h.unmount()
  })

  it('mounts the registry beneath each real workspace provider, including mini mode', () => {
    const path = resolve(directory, '../app-shell/AppShell.tsx')
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const owners: ts.JsxSelfClosingElement[] = []
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'WorkspaceBrowserRegistry') owners.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(owners).toHaveLength(2)
    for (const owner of owners) {
      expect(ts.isJsxElement(owner.parent)).toBe(true)
      expect((owner.parent as ts.JsxElement).openingElement.tagName.getText(source)).toBe('AppShellProvider')
    }
    expect(owners.some(owner => owner.getText(source).includes('enabled={browserSurfaceEnabled}'))).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)')
  })
})
