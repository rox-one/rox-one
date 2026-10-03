import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { MeetingRequestTracker } from '../meetings/request-state'

// Execute the real routed MeetingsPage callbacks and committed lease. This
// proves UI receipt ownership, not microphone/provider/server authorization.
const source = readFileSync(join(import.meta.dir, '../MeetingsPage.tsx'), 'utf8')
const ast = ts.createSourceFile('MeetingsPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MeetingsPage') as ts.FunctionDeclaration
if (!page?.body) throw new Error('Actual routed Meetings component missing')
const statements = page.body.statements
const effect = (kind: string, marker: string) => {
  const statement = statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === kind && node.getText(ast).includes(marker))
  if (!statement) throw new Error('Actual meeting effect missing: ' + marker)
  return statement.getText(ast)
}
const handlers = ['handlePlan', 'handleRecord', 'handleImport', 'cancelImport'] as const
const code = effect('useLayoutEffect', 'requestTracker.setScope') + effect('useEffect', 'api.onChanged')
  + effect('useEffect', 'api.list(workspaceId)') + effect('useEffect', 'api.readTranscript')
  + handlers.map(name => {
    const fn = statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    if (!fn) throw new Error('Actual meeting callback missing: ' + name)
    return fn.getText(ast)
  }).join('\n') + '\nreturn { handlePlan, handleRecord, handleImport, cancelImport };'
const executable = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }

function fixture() {
  const state = { meetings: [] as any[], title: '', at: '', selected: null as string | null, banner: null as string | null,
    planning: false, planningPending: false, importId: null as string | null, canceling: false, tab: '',
    load: '', engine: null as unknown, transcripts: {} as Record<string, string> }
  const requestTracker = new MeetingRequestTracker(), importRequestRef = { current: null as string | null }
  const planDraftRef = { current: { title: '', at: '' } }
  const catalogUpdatesRef = { current: null as Map<string, any> | null }
  let lease!: () => () => void, subscription!: () => () => void, catalog!: () => () => void,
    search!: () => (() => void) | undefined, listener!: (event: { id: string }) => void
  let createCalls = 0, importCalls = 0, recordCalls = 0, getCalls = 0, serial = 0
  let create = () => Promise.resolve({ id: 'created', workspaceId: 'a' })
  let importAudio = () => Promise.resolve<any>({ ok: true, value: { id: 'imported', workspaceId: 'a' } })
  let record = () => Promise.resolve<any>({ ok: true, meeting: { id: 'recorded', workspaceId: 'a' } })
  let get = (id: string) => Promise.resolve<any>({ id, workspaceId: 'a' })
  let list = () => Promise.resolve<any[]>([])
  let transcript = () => Promise.resolve<any>({ segments: [{ text: 'Transcript' }] })
  const api = {
    create: () => { createCalls++; return create() }, importAudio: () => { importCalls++; return importAudio() },
    cancelImport: async () => true, get: (id: string) => { getCalls++; return get(id) },
    onChanged: (fn: typeof listener) => { listener = fn; return () => {} },
    list: () => list(), engine: async () => null, readTranscript: () => transcript(),
  }
  const set = <K extends keyof typeof state>(key: K) => (next: typeof state[K] | ((old: typeof state[K]) => typeof state[K])) => {
    state[key] = typeof next === 'function' ? (next as (old: typeof state[K]) => typeof state[K])(state[key]) : next
  }
  const render = (workspaceId: string | null) => {
    planDraftRef.current = { title: state.title, at: state.at }
    const bindings = { api, workspaceId, requestTracker, importRequestRef, planDraftRef, catalogUpdatesRef,
      planTitle: state.title, planAt: state.at, importRequestId: state.importId,
      meetings: state.meetings, terms: ['search'], transcriptText: state.transcripts, reload: 0,
      transcriptPlainText: (segments: Array<{ text: string }>) => segments.map(segment => segment.text).join(' '),
      useLayoutEffect: (fn: typeof lease) => { lease = fn }, useEffect: (fn: typeof subscription) => {
        if (fn.toString().includes('api.onChanged')) subscription = fn
        else if (fn.toString().includes('api.list')) catalog = fn
        else search = fn
      },
      setLoadedWorkspaceId: () => {}, setMeetings: set('meetings'), setLoadState: set('load'), setEngine: set('engine'), setTranscriptText: set('transcripts'), setLocalSelectedId: set('selected'),
      setBanner: set('banner'), setPlanning: set('planning'), setPlanTitle: set('title'), setPlanAt: set('at'),
      setPlanningPending: set('planningPending'), setImportRequestId: set('importId'), setCancelingImport: set('canceling'),
      setTab: set('tab'), selectMeeting: set('selected'), newLocalId: () => 'import-' + ++serial,
      upsert: (meeting: any) => { state.meetings = [...state.meetings.filter(item => item.id !== meeting.id), meeting] },
      startRecording: () => { recordCalls++; return record() }, t: () => 'Recorded', dayFmt: { format: () => '' }, timeFmt: { format: () => '' },
    }
    const methods = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as Record<typeof handlers[number], (...args: any[]) => Promise<void>>
    return { ...methods, load: () => catalog(), search: () => search(),
      commit: () => { const close = lease(), unsubscribe = subscription(); return () => { close(); unsubscribe() } } }
  }
  const edit = (title: string, at = '') => { state.title = title; state.at = at; state.planning = true; planDraftRef.current = { title, at } }
  return { state, render, edit, emit: (id: string) => listener({ id }), listener: () => listener,
    calls: () => ({ create: createCalls, import: importCalls, record: recordCalls, get: getCalls }),
    useCreate: (fn: typeof create) => { create = fn }, useImport: (fn: typeof importAudio) => { importAudio = fn },
    useRecord: (fn: typeof record) => { record = fn }, useGet: (fn: typeof get) => { get = fn },
    useList: (fn: typeof list) => { list = fn }, useTranscript: (fn: typeof transcript) => { transcript = fn }, importRequestRef }
}

describe('actual routed meeting callbacks and committed scope', () => {
  test('uncommitted actions do not dispatch writes', async () => {
    const f = fixture(); f.edit('Plan'); const view = f.render('a')
    await view.handlePlan(); await view.handleRecord(); await view.handleImport()
    expect(f.calls()).toEqual({ create: 0, import: 0, record: 0, get: 0 })
  })
  test('duplicate plan clicks coalesce and a receipt retains text edited while pending', async () => {
    const f = fixture(), pending = deferred<{ id: string; workspaceId: string }>()
    const close = f.render('a').commit(); f.edit('Submitted', '2026-10-03T10:00'); f.useCreate(() => pending.promise)
    const view = f.render('a'), first = view.handlePlan(), duplicate = view.handlePlan()
    expect(f.calls().create).toBe(1); expect(f.state.planningPending).toBe(true)
    f.edit('Continued typing', '2026-10-04T10:00'); pending.resolve({ id: 'created', workspaceId: 'a' })
    await first; await duplicate
    expect(f.state).toMatchObject({ title: 'Continued typing', at: '2026-10-04T10:00', planning: true, planningPending: false, selected: 'created' })
    close()
  })
  test('rejection keeps a submitted draft and permits successful retry', async () => {
    const f = fixture(), close = f.render('a').commit(); f.edit('Plan'); f.useCreate(() => Promise.reject(new Error('denied')))
    await f.render('a').handlePlan(); expect(f.state).toMatchObject({ title: 'Plan', banner: 'unavailable', planningPending: false })
    f.useCreate(async () => ({ id: 'retried', workspaceId: 'a' })); await f.render('a').handlePlan()
    expect(f.calls().create).toBe(2); expect(f.state).toMatchObject({ title: '', at: '', planning: false, selected: 'retried' }); close()
  })
  test('A → B → A cannot apply an old plan or clear the newer pending owner', async () => {
    const f = fixture(), old = deferred<{ id: string; workspaceId: string }>(), current = deferred<{ id: string; workspaceId: string }>()
    let close = f.render('a').commit(); f.edit('Old'); f.useCreate(() => old.promise); const first = f.render('a').handlePlan()
    close(); close = f.render('b').commit(); close(); close = f.render('a').commit()
    f.edit('New'); f.useCreate(() => current.promise); const newer = f.render('a').handlePlan()
    old.resolve({ id: 'obsolete', workspaceId: 'a' }); await first
    expect(f.state).toMatchObject({ meetings: [], selected: null, title: 'New', planningPending: true })
    current.resolve({ id: 'current', workspaceId: 'a' }); await newer; expect(f.state.selected).toBe('current'); close()
  })
  test('a stale import success or denial cannot select elsewhere or release the next import', async () => {
    for (const rejected of [false, true]) {
      const f = fixture(), old = deferred<any>(), next = deferred<any>(); let close = f.render('a').commit()
      f.useImport(() => old.promise); const first = f.render('a').handleImport(); close(); close = f.render('b').commit()
      f.useImport(() => next.promise); const second = f.render('b').handleImport(), id = f.state.importId
      if (rejected) old.reject(new Error('late refusal')); else old.resolve({ ok: true, value: { id: 'obsolete', workspaceId: 'a' } })
      await first; expect(f.state).toMatchObject({ selected: null, banner: null, importId: id }); expect(f.importRequestRef.current).toBe(id)
      next.resolve({ ok: true, value: { id: 'current', workspaceId: 'b' } }); await second
      expect(f.state).toMatchObject({ selected: 'current', importId: null }); close()
    }
  })
  test('duplicate record starts coalesce and completion after disposal has no UI effect', async () => {
    const f = fixture(), pending = deferred<any>(), close = f.render('a').commit(); f.useRecord(() => pending.promise)
    const view = f.render('a'), first = view.handleRecord(); await view.handleRecord(); expect(f.calls().record).toBe(1)
    close(); pending.resolve({ ok: true, meeting: { id: 'recorded', workspaceId: 'a' } }); await first
    expect(f.state.meetings).toEqual([]); expect(f.state.selected).toBeNull()
  })
  test('latest per-meeting change wins, including a newer deletion', async () => {
    for (const removed of [false, true]) {
      const f = fixture(), old = deferred<any>(), newer = deferred<any>(), close = f.render('a').commit()
      let calls = 0; f.useGet(() => ++calls === 1 ? old.promise : newer.promise)
      f.emit('one'); f.emit('one'); newer.resolve(removed ? null : { id: 'one', workspaceId: 'a', title: 'New' }); await settle()
      old.resolve({ id: 'one', workspaceId: 'a', title: 'Old' }); await settle()
      expect(f.state.meetings).toEqual(removed ? [] : [{ id: 'one', workspaceId: 'a', title: 'New' }]); close()
    }
  })
  test('an old subscriber cannot issue a foreign read or publish after A → B → A', async () => {
    const f = fixture(), pending = deferred<any>(); let close = f.render('a').commit(); f.useGet(() => pending.promise)
    const oldSubscriber = f.listener(); f.emit('one'); close(); close = f.render('b').commit()
    oldSubscriber({ id: 'one' }); expect(f.calls().get).toBe(1); close(); close = f.render('a').commit()
    pending.resolve({ id: 'one', workspaceId: 'a', title: 'Obsolete' }); await settle(); expect(f.state.meetings).toEqual([]); close()
  })
  test('a pending catalogue preserves newer pushed records and deletions', async () => {
    for (const removed of [false, true]) {
      const f = fixture(), pending = deferred<any[]>(), close = f.render('a').commit()
      f.useList(() => pending.promise); const cleanup = f.render('a').load()
      f.useGet(async () => removed ? null : { id: 'one', workspaceId: 'a', title: 'New' })
      f.emit('one'); await settle()
      pending.resolve([{ id: 'one', workspaceId: 'a', title: 'Old' }, { id: 'two', workspaceId: 'a', title: 'Other' }]); await settle()
      expect(f.state.meetings).toEqual(removed ? [{ id: 'two', workspaceId: 'a', title: 'Other' }]
        : [{ id: 'one', workspaceId: 'a', title: 'New' }, { id: 'two', workspaceId: 'a', title: 'Other' }])
      expect(f.state.load).toBe('ready'); cleanup(); close()
    }
  })
  test('committed catalogue scope fences stale success and refusal before passive cleanup', async () => {
    for (const rejected of [false, true]) {
      const f = fixture(), pending = deferred<any[]>(); let close = f.render('a').commit()
      f.useList(() => pending.promise); const cleanup = f.render('a').load()
      close(); close = f.render('b').commit(); close(); close = f.render('a').commit()
      if (rejected) pending.reject(new Error('obsolete')); else pending.resolve([{ id: 'obsolete' }])
      await settle(); expect(f.state.meetings).toEqual([]); expect(f.state.load).toBe('loading')
      cleanup(); close()
    }
  })
  test('transcript search ignores old-workspace success/refusal, while current refusal stays explicit', async () => {
    for (const rejected of [false, true]) {
      const f = fixture(), pending = deferred<any>(); let close = f.render('a').commit()
      f.state.meetings = [{ id: 'one', transcript: { status: 'done' } }]
      f.useTranscript(() => pending.promise); const cleanup = f.render('a').search()
      close(); close = f.render('b').commit()
      if (rejected) pending.reject(new Error('obsolete')); else pending.resolve({ segments: [{ text: 'Foreign text' }] })
      await settle(); expect(f.state.transcripts).toEqual({}); expect(f.state.banner).toBeNull(); cleanup?.(); close()
    }
    const f = fixture(), close = f.render('a').commit()
    f.state.meetings = [{ id: 'one', transcript: { status: 'done' } }]
    f.useTranscript(() => Promise.reject(new Error('denied'))); const cleanup = f.render('a').search()
    await settle(); expect(f.state.banner).toBe('unavailable'); cleanup?.(); close()
  })
})
