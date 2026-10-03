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
const availability = ts.transpileModule(callback('readUnavailable') + callback('assetsUnavailable')
  + '\nreturn { readUnavailable, assetsUnavailable };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const readAvailability = (activeWorkspaceId: string, notesReadError: unknown, assetsReadError: unknown) =>
  new Function('activeWorkspaceId', 'notesReadError', 'assetsReadError', availability)(activeWorkspaceId, notesReadError, assetsReadError)
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
  const refs = { notesListRequestRef: { current: 0 }, assetsRequestRef: { current: 0 },
    readWorkspaceRef: { current: undefined as string | undefined }, readWorkspaceGenerationRef: { current: 0 }, readsMountedRef: { current: false } }
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
  test('optional asset refusal preserves canonical text Notes, and asset retry clears only its own error', async () => {
    const f = fixture(), error = { code: 'AUTH_FAILED', message: 'Optional asset access unavailable' }
    const notes = [{ id: 'canonical-readable-note' }]
    let available = false
    const view = f.render('a', { listNotes: async () => notes,
      listNoteAssets: async () => { if (!available) throw error; return [{ relativePath: 'authorized-asset.png' }] } })
    const dispose = view.commit()
    await view.refreshNotes(); await view.refreshAssets()
    const assetError = { workspaceId: 'a', code: 'AUTH_FAILED' }
    expect(f.events).toEqual([['notesError', null], ['notes', notes], ['order', ['canonical-readable-note']], ['assetsError', assetError]])
    expect(readAvailability('a', null, assetError)).toEqual({ readUnavailable: null, assetsUnavailable: assetError })
    available = true; await view.refreshAssets()
    expect(f.events.slice(4)).toEqual([['assetsError', null], ['assets', [{ relativePath: 'authorized-asset.png' }]]])
    expect(readAvailability('a', null, null)).toEqual({ readUnavailable: null, assetsUnavailable: null })
    dispose()
  })
  test('core Notes denial still closes the document surface; a foreign assets error cannot affect the current workspace', () => {
    const notesError = { workspaceId: 'a', code: 'AUTH_FAILED' }, assetsError = { workspaceId: 'b', code: 'AUTH_FAILED' }
    expect(readAvailability('a', notesError, assetsError)).toEqual({ readUnavailable: notesError, assetsUnavailable: null })
    expect(readAvailability('a', null, assetsError)).toEqual({ readUnavailable: null, assetsUnavailable: null })
  })
  test('refused optional assets stop actual upload/paste/rename/delete/cleanup handlers before any host probe or mutation', async () => {
    const actions = ['importFiles', 'handleImportAsset', 'openAssetRenameDialog', 'handleRenameAsset', 'handleDeleteAsset', 'handleCleanUnusedAssets']
    const code = ts.transpileModule(actions.map(callback).join('\n') + `\nreturn { ${actions.join(', ')} };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    let probes = 0
    const bindings = { React: { useCallback: (fn: unknown) => fn }, activeWorkspaceId: 'a', activeNote: { id: 'canonical-readable-note' },
      assetsUnavailable: { workspaceId: 'a', code: 'AUTH_FAILED' }, refreshAssets() { probes++ }, t() { probes++ },
      assetRenameTarget: { relativePath: 'a.png' }, assetRenameName: 'b.png', orphanAssets: [{ relativePath: 'a.png' }],
      setAssetRenameTarget() { probes++ }, setAssetRenameName() { probes++ }, setAssetBusy() { probes++ },
      window: { electronAPI: new Proxy({}, { get() { probes++; throw new Error('Host/file capability must not be probed') } }) } }
    const functions = new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as Record<string, (input?: unknown) => unknown>
    for (const name of actions) await functions[name]!({ relativePath: 'a.png' })
    expect(probes).toBe(0)
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
