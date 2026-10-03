import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Run the actual project read/delete callbacks and their mount cleanup. The
// controlled RPC replies cover races without claiming native/server authority.
const source = readFileSync(new URL('../ProjectInfoPage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ProjectInfoPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LocalProjectInfoPage') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual local project component missing')
const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
const callback = (name: string) => {
  const declaration = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name)
  if (!declaration?.initializer) throw new Error(`Actual callback missing: ${name}`)
  return `const ${name} = ${declaration.initializer.getText(ast)};`
}
const lifecycle = component.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes('void loadProject()'))
if (!lifecycle) throw new Error('Actual project cleanup missing')
const executable = ts.transpileModule(callback('loadProject') + lifecycle.getText(ast) + callback('handleDeleteProject')
  + '\nreturn { loadProject, handleDeleteProject };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const loadedProject = { config: { slug: 'project', name: 'Actual project' } }
function fixture(api: Record<string, unknown>, workspaceId: string | null = 'workspace', claimable = true) {
  const events: Array<[string, unknown]> = [], navigations: string[] = []
  // Direct callback tests start with the component committed; mount() also
  // exercises the production setup/cleanup contract independently.
  const refs = { projectRequestRef: { current: 0 }, projectMountedRef: { current: true } }
  let mount!: () => () => void
  const bindings = {
    ...refs, workspaceId, projectSlug: 'project', project: loadedProject,
    useCallback: (fn: unknown) => fn, useEffect: (fn: () => () => void) => { mount = fn },
    t: (key: string) => key, soupProjectListResult: () => ({ result: {} }), soupProjectReadResult: () => ({ result: {} }),
    soupProjectActResult: () => ({}), isClaimableLive: () => claimable,
    window: { confirm: () => true, electronAPI: api },
    navigate: (route: string) => navigations.push(route), routes: { view: { projects: () => 'projects' } },
    toast: { error: (message: string) => events.push(['toast', message]) }, console: { error: () => {} },
    ...Object.fromEntries(['Project', 'Error', 'Loading', 'EditName', 'EditDescription', 'EditWorkingDir', 'EditDetails', 'EditColor']
      .map(name => [`set${name}`, (value: unknown) => events.push([name, value])])),
  }
  const actual = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as {
    loadProject(): Promise<void>; handleDeleteProject(): Promise<void>
  }
  return { ...actual, events, navigations, refs, mount: () => mount() }
}

describe('UI-001 actual project read and delete ownership', () => {
  test('successful current read renders actual metadata and missing project clears the previous value', async () => {
    let value: typeof loadedProject | null = loadedProject
    const f = fixture({ getProject: async () => value })
    await f.loadProject()
    expect(f.events).toContainEqual(['Project', loadedProject])
    expect(f.events).toContainEqual(['EditName', 'Actual project'])
    value = null; f.events.length = 0; await f.loadProject()
    expect(f.events).toEqual([['Loading', true], ['Error', null], ['Error', 'projectInfo.notFound'], ['Project', null], ['Loading', false]])
  })
  test('late earlier success cannot revive a project after newer deletion read', async () => {
    const old = deferred<typeof loadedProject | null>(); let calls = 0
    const f = fixture({ getProject: () => ++calls === 1 ? old.promise : Promise.resolve(null) })
    const earlier = f.loadProject(); await f.loadProject(); f.events.length = 0
    old.resolve(loadedProject); await earlier
    expect(f.events).toEqual([])
  })
  test('late earlier refusal cannot overwrite newer successful metadata', async () => {
    const old = deferred<typeof loadedProject | null>(); let calls = 0
    const f = fixture({ getProject: () => ++calls === 1 ? old.promise : Promise.resolve(loadedProject) })
    const earlier = f.loadProject(); await f.loadProject(); f.events.length = 0
    old.reject(new Error('old refusal')); await earlier
    expect(f.events).toEqual([])
  })
  test('cleanup fences deferred success and failure replies', async () => {
    for (const reject of [false, true]) {
      const read = deferred<typeof loadedProject | null>(), f = fixture({ getProject: () => read.promise })
      const dispose = f.mount(); dispose(); f.events.length = 0
      if (reject) read.reject(new Error('disposed refusal')); else read.resolve(loadedProject)
      await read.promise.catch(() => {}); await Promise.resolve()
      expect(f.events).toEqual([])
      expect(f.refs.projectMountedRef.current).toBe(false)
    }
  })
  test('successful deletion invalidates pending reads and navigates once', async () => {
    const read = deferred<typeof loadedProject | null>()
    const f = fixture({ getProject: () => read.promise, deleteProject: async () => ({ ok: true }) })
    const dispose = f.mount()
    await f.handleDeleteProject(); f.events.length = 0
    read.resolve(loadedProject); await read.promise; await Promise.resolve()
    expect(f.events).toEqual([])
    expect(f.navigations).toEqual(['projects'])
    dispose()
  })
  test('deletion after leaving the route cannot navigate or toast over the new route', async () => {
    for (const reject of [false, true]) {
      const removal = deferred<unknown>(), f = fixture({ getProject: async () => loadedProject, deleteProject: () => removal.promise })
      const dispose = f.mount(), deleting = f.handleDeleteProject(); dispose(); f.events.length = 0
      if (reject) removal.reject(new Error('late deletion failure')); else removal.resolve({ ok: true })
      await deleting
      expect(f.events).toEqual([])
      expect(f.navigations).toEqual([])
    }
  })
  test('current refusal clears stale metadata; absent workspace or capability ends loading explicitly', async () => {
    const failed = fixture({ getProject: async () => { throw new Error('denied') } })
    await failed.loadProject()
    expect(failed.events).toContainEqual(['Project', null])
    expect(failed.events).toContainEqual(['Error', 'denied'])
    expect(failed.events.at(-1)).toEqual(['Loading', false])
    for (const f of [fixture({}, null), fixture({}, 'workspace', false)]) {
      await f.loadProject()
      expect(f.events).toEqual([['Project', null], ['Error', 'common.unavailable'], ['Loading', false]])
    }
  })
})
