import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { capabilityErrorCode, readScopedCapability } from '../../lib/scoped-capability-read'

// Execute the actual NotesPage committed lease and list/assets callbacks with
// controlled render/commit/dispose timing. These are UI lifecycle fixtures,
// not a NativePrincipal or server authorization acceptance test.
const source = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')
const ast = ts.createSourceFile('NotesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NativeNotesPage') as ts.FunctionDeclaration
if (!page?.body) throw new Error('Actual native Notes component missing')
const declarations = page.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
const callback = (name: string) => {
  const declaration = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name)
  if (!declaration?.initializer) throw new Error('Actual callback missing: ' + name)
  return `const ${name} = ${declaration.initializer.getText(ast)};`
}
const lease = page.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'useLayoutEffect')
if (!lease) throw new Error('Actual committed Notes lease missing')
const executable = ts.transpileModule(lease.getText(ast) + callback('refreshNotes') + callback('refreshAssets')
  + '\nreturn { refreshNotes, refreshAssets };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

const pending = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const refs = { notesListRequestRef: { current: 0 }, assetsRequestRef: { current: 0 }, readWorkspaceGenerationRef: { current: 0 },
    readWorkspaceRef: { current: undefined as string | undefined }, readsMountedRef: { current: false } }
  const events: Array<[string, unknown]> = []
  let commit!: () => () => void
  const render = (activeWorkspaceId: string | undefined, api: Record<string, unknown>) => {
    const bindings = { ...refs, activeWorkspaceId,
      React: { useLayoutEffect: (create: () => () => void) => { commit = create }, useCallback: (fn: unknown) => fn },
      window: { electronAPI: api }, readScopedCapability, capabilityErrorCode,
      soupDocumentListResult: () => ({ result: {} }), isClaimableLive: () => true,
      setNotesReadError: (value: unknown) => events.push(['notesError', value]),
      setAssetsReadError: (value: unknown) => events.push(['assetsError', value]),
      setNotes: (value: unknown) => events.push(['notes', value]),
      setSidebarOrder: (value: unknown) => events.push(['order', value]),
      setAllAssets: (value: unknown) => events.push(['assets', value]) }
    const functions = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as {
      refreshNotes(): Promise<void>; refreshAssets(): Promise<void>
    }
    return { ...functions, commit: () => commit() }
  }
  return { refs, events, render }
}

describe('actual NotesPage read callbacks and committed workspace lease', () => {
  test('uncommitted render cannot publish or read; committed successful list/assets retain actual data', async () => {
    const f = fixture(); let calls = 0
    const notes = [{ id: 'canonical-note' }], assets = [{ relativePath: 'actual.png' }]
    const view = f.render('a', { listNotes: async () => { calls++; return notes }, listNoteAssets: async () => assets })
    await view.refreshNotes(); expect(calls).toBe(0)
    const dispose = view.commit()
    await view.refreshNotes(); await view.refreshAssets()
    expect(calls).toBe(1)
    expect(f.events).toEqual([['notesError', null], ['notes', notes], ['order', ['canonical-note']], ['assetsError', null], ['assets', assets]])
    dispose()
  })
  test('actual list/assets denial is explicit unavailable and never an available empty result', async () => {
    const f = fixture(), error = { code: 'AUTH_FAILED', message: 'Document access denied' }
    const view = f.render('a', { listNotes: async () => { throw error }, listNoteAssets: async () => { throw error } })
    const dispose = view.commit(); await view.refreshNotes(); await view.refreshAssets()
    expect(f.events).toEqual([['notesError', { workspaceId: 'a', code: 'AUTH_FAILED' }], ['assetsError', { workspaceId: 'a', code: 'AUTH_FAILED' }]])
    dispose()
  })
  test('A → B → A without another list call cannot revive the old A success or denial', async () => {
    for (const method of ['refreshNotes', 'refreshAssets'] as const) for (const rejected of [false, true]) {
      const f = fixture(), deferred = pending<unknown[]>()
      const api = { listNotes: () => deferred.promise, listNoteAssets: () => deferred.promise }
      const a = f.render('a', api); const leaveA = a.commit(); const running = a[method]()
      leaveA(); const leaveB = f.render('b', api).commit()
      leaveB(); const leaveNewA = f.render('a', api).commit()
      if (rejected) deferred.reject({ code: 'AUTH_FAILED' }); else deferred.resolve([{ id: 'old-a' }])
      await running; expect(f.events).toEqual([])
      leaveNewA()
    }
  })
  test('dispose fences deferred list/assets success and refusal; newer same-workspace request wins', async () => {
    for (const method of ['refreshNotes', 'refreshAssets'] as const) for (const rejected of [false, true]) {
      const f = fixture(), deferred = pending<unknown[]>()
      const a = f.render('a', { listNotes: () => deferred.promise, listNoteAssets: () => deferred.promise })
      const dispose = a.commit(), running = a[method](); dispose()
      if (rejected) deferred.reject({ code: 'AUTH_FAILED' }); else deferred.resolve([{ id: 'disposed' }])
      await running; expect(f.events).toEqual([])
    }
    const f = fixture(), older = pending<Array<{ id: string }>>()
    let calls = 0
    const view = f.render('a', { listNotes: () => ++calls === 1 ? older.promise : Promise.resolve([{ id: 'newer' }]) })
    const dispose = view.commit(), oldRead = view.refreshNotes()
    await view.refreshNotes(); older.reject({ code: 'AUTH_FAILED' }); await oldRead
    expect(f.events).toEqual([['notesError', null], ['notes', [{ id: 'newer' }]], ['order', ['newer']]])
    dispose()
  })
})
