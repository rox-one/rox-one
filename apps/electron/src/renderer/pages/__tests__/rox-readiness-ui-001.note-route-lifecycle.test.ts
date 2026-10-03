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
const readLifecycle = component.body.statements.find(node => ts.isExpressionStatement(node)
  && node.getText(ast).includes('readsMountedRef.current = true') && node.getText(ast).includes('readWorkspaceGenerationRef'))
const subscription = component.body.statements.find(node => ts.isExpressionStatement(node)
  && node.getText(ast).includes('.onNotesChanged('))
if (!opening?.initializer || !lifecycle || !readLifecycle || !subscription) throw new Error('Actual note read, committed lease or subscription effect missing')
const executable = ts.transpileModule(`const openNote = ${opening.initializer.getText(ast)};\n${readLifecycle.getText(ast)}\n${lifecycle.getText(ast)}\n${subscription.getText(ast)}\nreturn { openNote };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const note = (id = 'selected') => ({ id, nativeId: id, content: `body:${id}`, tags: [] })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture(api: Record<string, unknown>, dirty = false) {
  const states: Record<string, unknown> = { ActiveNote: dirty ? note() : null, Content: dirty ? 'unsaved draft' : '' }
  const events: string[] = []
  const refs = {
    readsMountedRef: { current: false }, readWorkspaceRef: { current: 'workspace' }, workspaceIdRef: { current: 'workspace' },
    readWorkspaceGenerationRef: { current: 0 }, notesListRequestRef: { current: 0 }, assetsRequestRef: { current: 0 },
    openNoteRequestRef: { current: 0 }, activeNoteIdRef: { current: dirty ? 'selected' : null }, activeNoteRef: { current: dirty ? note() : null },
    contentRef: { current: dirty ? 'unsaved draft' : '' }, dirtyRef: { current: dirty }, saveBlockedRef: { current: false },
    revisionsRef: { current: new Map() }, expectedRevisionByNoteRef: { current: new Map() }, nativeRevisionByNoteRef: { current: new Map() },
  }
  let listener: (payload: unknown) => void = () => {}
  const render = (activeWorkspaceId = 'workspace') => {
    const commits: Array<() => () => void> = [], subscriptions: Array<() => (() => void) | undefined> = []
    const bindings = {
      ...refs, activeWorkspaceId, selectedNoteId: 'selected', capabilityErrorCode,
      React: {
        useCallback: (fn: unknown) => fn,
        useLayoutEffect: (fn: () => () => void) => { commits.push(fn) },
        useEffect: (fn: () => (() => void) | undefined) => { subscriptions.push(fn) },
      },
      t: (key: string) => key, soupDocumentReadResult: () => ({ result: {} }), isClaimableLive: () => true,
      nativeNotesSync: { start: async () => {}, flush: async () => {}, stop: async () => {} },
      window: { electronAPI: {
        isChannelAvailable: () => false, watchNotes: async () => {}, unwatchNotes: async () => {},
        onNotesChanged: (callback: typeof listener) => { listener = callback; return () => events.push('unsubscribe') }, ...api,
      } }, RPC_CHANNELS: { content: { RESOLVE: 'resolve' } },
      contentHash: (content: string) => `hash:${content}`, noteRevisionKey: (workspace: string, id: string) => `${workspace}\0${id}`,
      normalizeChangedPayload: (payload: unknown) => payload, parseNoteBlockAddress: (id: string) => ({ noteId: id }),
      refreshNotes: () => events.push('refreshNotes'), refreshAssets: () => events.push('refreshAssets'), refreshIndexHealth: () => {},
      toast: { error: () => events.push('toast') },
      ...Object.fromEntries(['NoteOpenError', 'ActiveNote', 'Content', 'Dirty', 'Loading', 'ContentResolution', 'Saving', 'SaveError', 'SaveNeedsReload', 'ExternalChange', 'TagDraft']
        .map(name => [`set${name}`, (value: unknown) => { states[name] = value; events.push(name) }])),
    }
    const callbacks = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as {
      openNote(id: string): Promise<void>
    }
    return {
      ...callbacks,
      commit: () => { const disposers = commits.map(create => create()); return () => disposers.forEach(dispose => dispose()) },
      subscribe: () => subscriptions[0](),
    }
  }
  const initial = render(), disposeCommit = initial.commit(), disposeSubscription = initial.subscribe()
  events.length = 0
  return {
    ...initial, refs, states, events, render, disposeCommit, disposeSubscription,
    onChanged: (payload: unknown) => listener(payload), retainedCallback: () => listener,
  }
}

describe('UI-001 actual selected note read and deletion callbacks', () => {
  test('missing selected note persists explicit state and successful Retry clears it with real body', async () => {
    let missing = true
    const f = fixture({ readNote: async () => { if (missing) throw { code: 'NOT_FOUND' }; return note() } })
    await f.openNote('selected')
    expect(f.states.NoteOpenError).toEqual({ workspaceId: 'workspace', noteId: 'selected', code: 'NOT_FOUND' })
    expect(f.states.ActiveNote).toBeNull()
    expect(f.states.Loading).toBe(false)
    expect(f.events).not.toContain('toast')
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
    expect(f.events).toContain('toast')
  })
  test('real I/O and authority failures stay unavailable and report an error', async () => {
    for (const code of ['HANDLER_ERROR', 'AUTH_FAILED', 'DOCUMENT_AUTHORITY_CHANGED']) {
      const f = fixture({ readNote: async () => { throw { code, message: 'ENOENT: unrelated dependency' } } })
      await f.openNote('selected')
      expect(f.states.NoteOpenError).toEqual({ workspaceId: 'workspace', noteId: 'selected', code })
      expect(f.events).toContain('toast')
      expect(f.states.Loading).toBe(false)
    }
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
  test('retained listener after actual unsubscribe cannot mutate the current draft', async () => {
    const f = fixture({}, true), queued = f.retainedCallback()
    f.disposeSubscription!(); await flush(); expect(f.events).toContain('unsubscribe')
    f.events.length = 0
    queued({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    queued({ workspaceId: 'workspace', reason: 'external', noteId: 'selected' })
    expect(f.events).toEqual([])
    expect(f.states.Content).toBe('unsaved draft')
    expect(f.refs.saveBlockedRef.current).toBe(false)
  })
  test('workspace A→B→A rejects retained A callbacks while the new A subscription still works', async () => {
    const f = fixture({}, true), queued = f.retainedCallback()
    f.disposeCommit()
    const b = f.render('workspace-b'), disposeB = b.commit(), offB = b.subscribe()
    offB!(); disposeB()
    const a = f.render(), disposeA = a.commit(), offA = a.subscribe()
    await flush(); f.events.length = 0
    // Deliberately retain the original subscription until after the ABA event:
    // committed generation alone must reject the old listener.
    queued({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    expect(f.events).toEqual([])
    expect(f.refs.saveBlockedRef.current).toBe(false)
    f.onChanged({ workspaceId: 'workspace', reason: 'delete', noteId: 'selected' })
    expect(f.states.Content).toBe('unsaved draft')
    expect(f.states.SaveNeedsReload).toBe(true)
    expect(f.refs.saveBlockedRef.current).toBe(true)
    f.disposeSubscription!(); offA!(); disposeA()
  })
  test('late descriptor rejection after same-note reopen cannot deny the newer document', async () => {
    const descriptor = deferred<unknown>(), f = fixture({ readNote: async () => note(), resolveContent: () => descriptor.promise }, true)
    f.onChanged({ workspaceId: 'workspace', reason: 'descriptor', noteId: 'selected' })
    await f.openNote('selected')
    const currentResolution = f.states.ContentResolution
    f.events.length = 0
    descriptor.reject(new Error('old descriptor refused')); await flush()
    expect(f.events).toEqual([])
    expect(f.states.ContentResolution).toEqual(currentResolution)
    expect(f.states.SaveNeedsReload).toBe(false)
    expect(f.states.Content).toBe('body:selected')
  })
  test('late descriptor success and rejection cannot publish into a new workspace owner', async () => {
    for (const rejected of [false, true]) {
      const descriptor = deferred<unknown>(), f = fixture({ resolveContent: () => descriptor.promise }, true)
      f.onChanged({ workspaceId: 'workspace', reason: 'descriptor', noteId: 'selected' })
      f.disposeSubscription!(); f.disposeCommit()
      const b = f.render('workspace-b'), disposeB = b.commit(), offB = b.subscribe()
      offB!(); disposeB()
      const a = f.render(), disposeA = a.commit(), offA = a.subscribe()
      f.states.ContentResolution = { status: 'ok', revision: 'new-owner', capabilities: { write: true } }
      f.states.SaveNeedsReload = false
      await flush(); f.events.length = 0
      if (rejected) descriptor.reject(new Error('old owner refused'))
      else descriptor.resolve({ status: 'ok', revision: 'old-owner', capabilities: { write: false } })
      await flush()
      expect(f.events).toEqual([])
      expect(f.states.ContentResolution).toEqual({ status: 'ok', revision: 'new-owner', capabilities: { write: true } })
      expect(f.states.SaveNeedsReload).toBe(false)
      offA!(); disposeA()
    }
  })
  test('owned descriptor failures still deny and require source reload', async () => {
    const descriptor = deferred<unknown>(), f = fixture({ resolveContent: () => descriptor.promise }, true)
    f.onChanged({ workspaceId: 'workspace', reason: 'descriptor', noteId: 'selected' })
    descriptor.reject(new Error('current descriptor refused')); await flush()
    expect(f.states.ContentResolution).toEqual({ status: 'error', code: 'denied' })
    expect(f.states.SaveNeedsReload).toBe(true)
    expect(f.states.Content).toBe('unsaved draft')
  })

})
