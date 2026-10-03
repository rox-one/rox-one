import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { capabilityErrorCode } from '../../lib/scoped-capability-read'

const source = readFileSync(new URL('../NotesPage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('NotesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NativeNotesPage') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual Notes component missing')
const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
const opening = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === 'openNote')
const lifecycle = component.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes('workspaceIdRef.current = activeWorkspaceId') && node.getText(ast).includes('openNoteRequestRef'))
let changed: ts.ArrowFunction | undefined
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'onNotesChanged') changed = node.arguments[0] as ts.ArrowFunction
  ts.forEachChild(node, visit)
}
visit(component)
if (!opening?.initializer || !lifecycle || !changed) throw new Error('Actual note read, committed lease or delete callback missing')
const executable = ts.transpileModule(`const openNote = ${opening.initializer.getText(ast)};\n${lifecycle.getText(ast)}\nconst onChanged = ${changed.getText(ast)};\nreturn { openNote, onChanged };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const note = (id = 'selected') => ({ id, nativeId: id, content: `body:${id}`, tags: [] })
function fixture(api: Record<string, unknown>, dirty = false) {
  const states: Record<string, unknown> = { ActiveNote: dirty ? note() : null, Content: dirty ? 'unsaved draft' : '' }
  const events: string[] = []
  const refs = {
    readsMountedRef: { current: true }, readWorkspaceRef: { current: 'workspace' }, workspaceIdRef: { current: 'workspace' },
    openNoteRequestRef: { current: 0 }, activeNoteIdRef: { current: dirty ? 'selected' : null }, activeNoteRef: { current: dirty ? note() : null },
    contentRef: { current: dirty ? 'unsaved draft' : '' }, dirtyRef: { current: dirty }, saveBlockedRef: { current: false },
    revisionsRef: { current: new Map() }, expectedRevisionByNoteRef: { current: new Map() }, nativeRevisionByNoteRef: { current: new Map() },
  }
  let commit!: () => () => void
  const bindings = {
    ...refs, activeWorkspaceId: 'workspace', selectedNoteId: 'selected', capabilityErrorCode,
    React: { useCallback: (fn: unknown) => fn, useLayoutEffect: (fn: () => () => void) => { commit = fn } },
    t: (key: string) => key, soupDocumentReadResult: () => ({ result: {} }), isClaimableLive: () => true,
    window: { electronAPI: { isChannelAvailable: () => false, ...api } }, RPC_CHANNELS: { content: { RESOLVE: 'resolve' } },
    contentHash: (content: string) => `hash:${content}`, noteRevisionKey: (workspace: string, id: string) => `${workspace}\0${id}`,
    normalizeChangedPayload: (payload: unknown) => payload, parseNoteBlockAddress: (id: string) => ({ noteId: id }),
    refreshNotes: () => events.push('refreshNotes'), refreshAssets: () => events.push('refreshAssets'), refreshIndexHealth: () => {},
    toast: { error: () => events.push('toast') },
    ...Object.fromEntries(['NoteOpenError', 'ActiveNote', 'Content', 'Dirty', 'Loading', 'ContentResolution', 'Saving', 'SaveError', 'SaveNeedsReload', 'ExternalChange', 'TagDraft']
      .map(name => [`set${name}`, (value: unknown) => { states[name] = value; events.push(name) }])),
  }
  const callbacks = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as {
    openNote(id: string): Promise<void>; onChanged(payload: unknown): void
  }
  return { ...callbacks, refs, states, events, commit: () => commit() }
}

describe('UI-001 actual selected note read and deletion callbacks', () => {
  test('missing selected note persists explicit state and successful Retry clears it with real body', async () => {
    let missing = true
    const f = fixture({ readNote: async () => { if (missing) throw { code: 'NOT_FOUND' }; return note() } })
    await f.openNote('selected')
    expect(f.states.NoteOpenError).toEqual({ workspaceId: 'workspace', noteId: 'selected', code: 'NOT_FOUND' })
    expect(f.states.ActiveNote).toBeNull()
    expect(f.states.Loading).toBe(false)
    missing = false; await f.openNote('selected')
    expect(f.states.NoteOpenError).toBeNull()
    expect(f.states.ActiveNote).toEqual(note())
    expect(f.states.Content).toBe('body:selected')
  })
  test('denied selected note remains explicit unavailable instead of a generic pick state', async () => {
    const f = fixture({ readNote: async () => { throw { code: 'AUTH_FAILED' } } })
    await f.openNote('selected')
    expect(f.states.NoteOpenError).toEqual({ workspaceId: 'workspace', noteId: 'selected', code: 'AUTH_FAILED' })
    expect(f.states.ActiveNote).toBeNull()
  })
  test('older success and refusal cannot replace the latest opened note', async () => {
    for (const rejected of [false, true]) {
      const old = deferred<ReturnType<typeof note>>()
      const f = fixture({ readNote: (_workspace: string, id: string) => id === 'old' ? old.promise : Promise.resolve(note(id)) })
      const opening = f.openNote('old'); await f.openNote('new'); f.events.length = 0
      if (rejected) old.reject({ code: 'NOT_FOUND' }); else old.resolve(note('old'))
      await opening
      expect(f.events).toEqual([])
      expect(f.states.ActiveNote).toEqual(note('new'))
    }
  })
  test('uncommitted calls do no RPC; actual committed lease cleanup fences late replies', async () => {
    const pending = deferred<ReturnType<typeof note>>(); let calls = 0
    const f = fixture({ readNote: () => { calls++; return pending.promise } })
    f.refs.readsMountedRef.current = false; await f.openNote('selected'); expect(calls).toBe(0)
    f.refs.readsMountedRef.current = true
    const dispose = f.commit(), opening = f.openNote('selected'); dispose(); f.events.length = 0
    pending.resolve(note()); await opening
    expect(f.events).toEqual([])
  })
  test('delete event for a pending selected target fences late body and shows persistent missing state', async () => {
    const pending = deferred<ReturnType<typeof note>>(), f = fixture({ readNote: () => pending.promise })
    const opening = f.openNote('selected')
    f.onChanged({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    expect(f.states.NoteOpenError).toEqual({ workspaceId: 'workspace', noteId: 'selected', code: 'NOT_FOUND' })
    expect(f.states.ActiveNote).toBeNull()
    f.events.length = 0; pending.resolve(note()); await opening
    expect(f.events).toEqual([])
    expect(f.states.ActiveNote).toBeNull()
  })
  test('external deletion retains the dirty body and blocks replacing the deleted source', () => {
    const f = fixture({}, true)
    f.onChanged({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    expect(f.states.ActiveNote).toEqual(note())
    expect(f.states.Content).toBe('unsaved draft')
    expect(f.refs.contentRef.current).toBe('unsaved draft')
    expect(f.refs.dirtyRef.current).toBe(true)
    expect(f.refs.saveBlockedRef.current).toBe(true)
    expect(f.states.ContentResolution).toEqual({ status: 'error', code: 'deleted' })
    expect(f.states.SaveError).toBe('notes.content.deleted')
    expect(f.states.SaveNeedsReload).toBe(true)
  })
  test('foreign workspace and disposed subscriptions cannot delete the visible draft', () => {
    const f = fixture({}, true)
    f.onChanged({ workspaceId: 'other', reason: 'delete', noteId: 'selected' })
    f.refs.readsMountedRef.current = false
    f.onChanged({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    expect(f.events).toEqual([])
    expect(f.states.Content).toBe('unsaved draft')
  })
})
