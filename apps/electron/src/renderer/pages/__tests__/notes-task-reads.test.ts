/**
 * PERF-09 (#1576) review round 4: the Notes task pass must never read the
 * corpus twice, and never project one workspace's list into another's cache.
 *
 * - A principal-mode listing already carries every note's markdown: tasks are
 *   built from it without a single `readNote`.
 * - A metadata-only listing (local mode, or a persisted/disk-restored slice
 *   adopted while the fresh listing is still in flight) falls back to per-note
 *   reads — exactly one per note, even when a second pass overlaps the first.
 * - A workspace switch retires the held list: the pass the switch itself
 *   triggers is dropped instead of cleaning, reading or overwriting the new
 *   workspace's cache, and the new workspace's pass runs even when its list
 *   matches the old one by ids and versions.
 *
 * Runs the real `refreshNotes`/`refreshTasks` callbacks and the workspace
 * reset and `[notes]` claim effects extracted from NotesPage.tsx with
 * controlled read timing, mirroring the page's wiring:
 * the `[noteIds]` effect, the hydration adoption subscription and
 * the listing read all drive the task pass.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import type { NoteDocument, NoteSummary } from '../../../shared/types'
import { createRoxQueryClient, resetRoxQueryClientForTests, roxQueryClient } from '../../lib/query/client'
import { cachedNotesList, fetchNotesList, notesTaskCache, subscribeCachedNotesList } from '../../lib/query/notes-cache'
import { roxKeys } from '../../lib/query/keys'
import { capabilityErrorCode, readScopedCapability } from '../../lib/scoped-capability-read'

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
const moduleHelper = (name: string) => {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  if (!declaration) throw new Error('Actual module helper missing: ' + name)
  return declaration.getText(ast)
}
// The page's committed effects are compiled from the source: dropping the
// workspace-reset kick or the `[notes]` claim sync must fail these tests.
const effectCallback = (name: string, kind: 'useEffect' | 'useLayoutEffect', deps: string, bodyNeedle?: string) => {
  const effect = page.body!.statements
    .filter(ts.isExpressionStatement)
    .map(node => node.expression)
    .filter((node): node is ts.CallExpression => ts.isCallExpression(node))
    .find(node => node.expression.getText(ast) === `React.${kind}`
      && node.arguments[1]?.getText(ast) === deps
      && (!bodyNeedle || node.arguments[0]!.getText(ast).includes(bodyNeedle)))
  const callback = effect?.arguments[0]
  if (!callback) throw new Error(`Actual ${kind} ${deps} effect missing: ` + (bodyNeedle ?? ''))
  return `const ${name} = ${callback.getText(ast)};`
}
const executable = ts.transpileModule(
  moduleHelper('listedNoteContent') + '\n' + moduleHelper('extractTasks') + '\n'
  + callback('refreshNotes') + callback('refreshTasks') + '\n'
  + effectCallback('resetEffect', 'useLayoutEffect', '[activeWorkspaceId]', 'cachedNotesList(activeWorkspaceId)') + '\n'
  + effectCallback('syncClaimEffect', 'useEffect', '[notes]') + '\n'
  + effectCallback('attachCacheEffect', 'useLayoutEffect', '[]', 'notesTaskCache<NoteTask>') + '\n'
  + 'return { refreshNotes, refreshTasks, resetEffect, syncClaimEffect, attachCacheEffect };',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

interface NoteTask { noteId: string; noteTitle: string; line: number; text: string; checked: boolean }
interface TaskReadView {
  refreshNotes(options?: { mount?: boolean }): Promise<void>
  refreshTasks(sourceNotes?: NoteSummary[]): Promise<void>
  resetEffect(): void
  syncClaimEffect(): void
  attachCacheEffect(): void
}
interface Pending<T> { promise: Promise<T>; resolve(value: T): void }
interface TaskReadFixture {
  state: { notes: NoteSummary[]; allTasks: NoteTask[][] }
  listing: Pending<NoteSummary[]>
  reads: Map<string, Pending<NoteDocument>>
  readCount: Map<string, number>
  listCalls(): number
  workspacesRead(): string[]
  refreshNotes(options?: { mount?: boolean }): Promise<void>
  hydrate(notes: NoteSummary[], workspaceId?: string): void
  resolveReads(updatedAtById: Record<string, number>, contentById?: Record<string, string>): void
  switchTo(workspaceId: string): TaskReadView
  stop(): void
}

/** Drain the microtask queue: every promise here is test-resolved, no clock involved. */
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }

function pending<T>(): Pending<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

const summary = (id: string, updatedAt: number): NoteSummary => ({
  id, title: `Note ${id}`, path: `/notes/${id}.md`, relativePath: `${id}.md`, tags: [], properties: {},
  links: [], assetRefs: [], updatedAt, createdAt: 0, size: 1,
})
const document = (id: string, updatedAt: number, content: string): NoteDocument => ({ ...summary(id, updatedAt), content, backlinks: [] })

const CONTENT: Record<string, string> = {
  n1: '- [ ] alpha',
  n2: '- [x] beta\n- [ ] gamma',
  n3: 'no tasks here',
}
const documents = (updatedAtById: Record<string, number>) =>
  Object.keys(updatedAtById).map(id => document(id, updatedAtById[id]!, CONTENT[id]!))

/** A fixture whose reads are answered by the test, never by timers. */
function fixture(options: { cachedTasks?: NoteTask[] } = {}): TaskReadFixture {
  resetRoxQueryClientForTests(createRoxQueryClient())
  const state = { notes: [] as NoteSummary[], allTasks: [] as NoteTask[][] }
  const reads = new Map<string, Pending<NoteDocument>>()
  const readCount = new Map<string, number>()
  const workspacesRead: string[] = []
  let listCalls = 0
  const listing = pending<NoteSummary[]>()
  const api = {
    listNotes: (_workspaceId: string) => { listCalls++; return listing.promise },
    readNote: (workspaceId: string, noteId: string) => {
      workspacesRead.push(workspaceId)
      readCount.set(noteId, (readCount.get(noteId) ?? 0) + 1)
      const read = pending<NoteDocument>()
      reads.set(noteId, read)
      return read.promise
    },
  }
  const refs = {
    notesListRequestRef: { current: 0 }, readWorkspaceRef: { current: 'ws' as string | undefined },
    readsMountedRef: { current: true }, notesFreshWorkspaceRef: { current: null as string | null },
    notesHandoffWorkspaceRef: { current: 'ws' as string | null },
    notesListWorkspaceRef: { current: 'ws' as string | null },
    taskRequestRef: { current: 0 }, taskCacheWorkspaceRef: { current: null as string | null },
    taskInFlightRef: { current: new Map<string, Promise<NoteDocument>>() },
    notesListingPendingRef: { current: false },
    refreshTasksRef: { current: null as null | ((sourceNotes?: NoteSummary[]) => Promise<void>) },
  }
  // The component's refs live for the whole lifetime: a workspace switch swaps
  // the compiled closures and the shared task-cache entry they are bound to.
  const taskCacheRef = { current: new Map<string, NoteTask[]>() }
  const taskCacheUpdatedAtRef = { current: new Map<string, number>() }
  let notesList: NoteSummary[] = state.notes
  let noteIds = ''
  let view: TaskReadView
  const installNotes = (notes: NoteSummary[], workspaceId: string) => {
    state.notes = notes
    notesList = notes
    refs.notesHandoffWorkspaceRef.current = workspaceId
  }
  // The page's `[noteIds]` effect, including the workspace prefix: the pass
  // re-runs whenever the key changes (a new workspace, ids or versions). The
  // list and the closure are those of the render that committed the effect.
  const noteIdsEffect = (workspaceId: string, list: NoteSummary[], run: (sourceNotes?: NoteSummary[]) => Promise<void>) => {
    const next = `${workspaceId}:${list.map(note => `${note.id}:${note.updatedAt}`).join(',')}`
    if (next === noteIds) return
    noteIds = next
    void run(list)
  }
  const compile = (workspaceId: string): TaskReadView => {
    const bindings: Record<string, unknown> = {
      React: { useCallback: (fn: unknown) => fn },
      activeWorkspaceId: workspaceId,
      ...refs, taskCacheRef, taskCacheUpdatedAtRef,
      window: { electronAPI: api },
      readScopedCapability, capabilityErrorCode, fetchNotesList, cachedNotesList,
      soupDocumentListResult: () => ({ result: {} }), isClaimableLive: () => true,
      setNotesReadError: () => {},
      setNotes: (next: NoteSummary[]) => {
        installNotes(next, workspaceId)
        // The write schedules a re-render: the effects it commits run with
        // that render's closure and list, while `refreshTasksRef` still points
        // at the callback of the render that performed the write — React only
        // updates the ref when the re-render commits.
        view = compile(workspaceId)
        view.syncClaimEffect()
        noteIdsEffect(workspaceId, next, view.refreshTasks)
      },
      setSidebarOrder: () => {},
      notes: notesList,
      notesTaskCache,
      setAllTasks: (tasks: NoteTask[]) => { state.allTasks.push(tasks) },
    }
    const compiled = new Function(...Object.keys(bindings), executable) as unknown as (...values: unknown[]) => TaskReadView
    return compiled(...Object.values(bindings))
  }
  // The mount layout effect attaches this workspace's shared task cache (and,
  // on a warm cache, hands its tasks to the page before any pass).
  if (options.cachedTasks) {
    const cache = notesTaskCache<NoteTask>('ws')
    for (const task of options.cachedTasks) {
      cache.tasks.set(task.noteId, [task])
      cache.updatedAt.set(task.noteId, 0)
    }
  }
  view = compile('ws')
  view.attachCacheEffect()
  refs.refreshTasksRef.current = view.refreshTasks
  const unsubscribe = subscribeCachedNotesList('ws', notes => {
    if (refs.notesFreshWorkspaceRef.current === 'ws') return
    installNotes(notes, 'ws')
    // The write's re-render commits before this callback returns.
    view = compile('ws')
    view.syncClaimEffect()
    noteIdsEffect('ws', notes, view.refreshTasks)
    refs.refreshTasksRef.current = view.refreshTasks
  })
  return {
    state, reads, readCount, listing,
    listCalls: () => listCalls,
    workspacesRead: () => workspacesRead,
    refreshNotes: async (options?: { mount?: boolean }) => {
      await view.refreshNotes(options)
      // Listing installs schedule re-renders: they commit before the caller
      // resumes.
      refs.refreshTasksRef.current = view.refreshTasks
    },
    hydrate: (notes: NoteSummary[], workspaceId = 'ws') => { roxQueryClient().setQueryData(roxKeys.notesList(workspaceId), notes) },
    resolveReads: (updatedAtById: Record<string, number>, contentById: Record<string, string> = CONTENT) => {
      for (const [id, read] of reads) read.resolve(document(id, updatedAtById[id]!, contentById[id]!))
    },
    switchTo: (workspaceId: string) => {
      // The lease layout effect, then the render whose closures see the new
      // workspace while the old workspace's list is still held.
      refs.readWorkspaceRef.current = workspaceId
      const held = notesList
      const next = compile(workspaceId)
      view = next
      refs.refreshTasksRef.current = next.refreshTasks
      // Commit 1's state-list effect recomputes its key under the new
      // workspace for the retired list and hands the pass over through that
      // render's closure — the claim still names the retired workspace, so the
      // pass must be dropped; the key it records is what commit 2 compares
      // against.
      noteIdsEffect(workspaceId, held, next.refreshTasks)
      // The reset layout effect retires the held list, installs the new
      // workspace's cached slice and hands that slice to the pass itself — the
      // state-list effect cannot see the change when it matches by ids and
      // versions. Installing the slice drives commit 2's effects (claim sync,
      // then the state-list effect) through the setNotes binding.
      next.resetEffect()
      // The re-render that installed the slice commits: the ref moves to its
      // callback before any later caller reads it.
      refs.refreshTasksRef.current = view.refreshTasks
      return view
    },
    stop: unsubscribe,
  }
}

let view: TaskReadFixture
beforeEach(() => { view = fixture() })
afterEach(() => { view.stop() })

const taskTexts = () => view.state.allTasks.at(-1)?.map(task => task.text) ?? []

describe('PERF-09 round 4: Notes builds tasks from the listing, not from a second corpus pass', () => {
  test('a warm task cache is attached at mount and shown before any pass runs', () => {
    const warm = fixture({ cachedTasks: [
      { noteId: 'n1', noteTitle: 'Note n1', line: 1, text: 'alpha', checked: false },
      { noteId: 'n2', noteTitle: 'Note n2', line: 1, text: 'beta', checked: false },
    ] })
    try {
      expect(warm.state.allTasks.at(-1)?.map(task => task.text).sort()).toEqual(['alpha', 'beta'])
      expect(warm.listCalls()).toBe(0)
      expect(warm.workspacesRead()).toEqual([])
    } finally {
      warm.stop()
    }
  })

  test('principal listing: tasks come from the documents it carries — no readNote at all', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.listing.resolve(documents({ n1: 100, n2: 200, n3: 300 }))
    await mounted
    await settle()
    expect(view.listCalls()).toBe(1)
    expect([...view.readCount]).toEqual([])
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('adopted persisted slice + changed note while the listing is in flight: still no readNote', async () => {
    const mounted = view.refreshNotes({ mount: true })
    // The disk restore lands mid-flight: metadata only, one note already stale.
    view.hydrate([summary('n1', 100), summary('n2', 100), summary('n3', 300)])
    await settle()
    view.listing.resolve(documents({ n1: 100, n2: 999, n3: 300 }))
    await mounted
    await settle()
    expect([...view.readCount]).toEqual([])
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('metadata-only listing (local mode): each note is read exactly once, overlapping passes included', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.hydrate([summary('n1', 100), summary('n2', 100), summary('n3', 300)])
    await settle()
    view.listing.resolve([summary('n1', 100), summary('n2', 999), summary('n3', 300)])
    await mounted
    await settle()
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    expect(view.reads.size).toBe(3)
    view.resolveReads({ n1: 100, n2: 999, n3: 300 })
    await settle()
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('warm cache serves the listing without RPC: tasks still read each note once', async () => {
    view.hydrate([summary('n1', 100), summary('n2', 200), summary('n3', 300)])
    await settle()
    // A mount inside the SWR window is answered from the metadata entry.
    const mounted = view.refreshNotes({ mount: true })
    await mounted
    await settle()
    expect(view.listCalls()).toBe(0)
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    view.resolveReads({ n1: 100, n2: 200, n3: 300 })
    await settle()
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('a change-driven refresh always lists once, and its documents replace pending reads', async () => {
    view.hydrate([summary('n1', 100), summary('n2', 200), summary('n3', 300)])
    await settle()
    const mounted = view.refreshNotes({ mount: true })
    await mounted
    await settle()
    expect(view.listCalls()).toBe(0)
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    // A non-mount refresh revalidates the listing whatever the SWR window says.
    const refreshed = view.refreshNotes()
    expect(view.listCalls()).toBe(1)
    view.listing.resolve(documents({ n1: 100, n2: 200, n3: 300 }))
    await refreshed
    await settle()
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('PERF-09 round 4: a task pass never mixes workspaces', () => {
  test('a switch with a held metadata list never reads that list into the new workspace', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.listing.resolve([summary('n1', 100), summary('n2', 200), summary('n3', 300)])
    await mounted
    await settle()
    // Local mode: the listing carries no content, so the mount pass reads once.
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    view.resolveReads({ n1: 100, n2: 200, n3: 300 })
    await settle()
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    // Switch to a workspace with no cached slice while the old list is held.
    const b = view.switchTo('ws-b')
    await settle()
    // The held list belongs to the retired workspace: no read is issued for it.
    expect(view.workspacesRead()).toEqual(['ws', 'ws', 'ws'])
    expect(notesTaskCache<NoteTask>('ws-b').tasks.size).toBe(0)
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    // The new workspace's own listing then feeds its cache, and only it.
    await b.refreshTasks(documents({ n1: 100 }))
    expect(view.workspacesRead()).toEqual(['ws', 'ws', 'ws'])
    expect(notesTaskCache<NoteTask>('ws-b').tasks.size).toBe(1)
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    expect(taskTexts()).toEqual(['alpha'])
  })

  test('whole documents held in state never seed — or evict — the next workspace cache', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.listing.resolve(documents({ n1: 100, n2: 200, n3: 300 }))
    await mounted
    await settle()
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    // The new workspace has a warm cache of its own (a different note).
    view.hydrate([summary('m1', 500)], 'ws-b')
    const warm = notesTaskCache<NoteTask>('ws-b')
    warm.tasks.set('m1', [{ noteId: 'm1', noteTitle: 'm1', line: 1, text: 'delta', checked: false }])
    warm.updatedAt.set('m1', 500)
    // The state now carries whole documents (principal mode); the pass the
    // switch triggers must not project their tasks into the next workspace,
    // nor treat them as the new workspace's census.
    view.switchTo('ws-b')
    await settle()
    expect(view.workspacesRead()).toEqual([])
    expect([...notesTaskCache<NoteTask>('ws-b').tasks.keys()]).toEqual(['m1'])
    expect(notesTaskCache<NoteTask>('ws-b').updatedAt.size).toBe(1)
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    expect(taskTexts()).toEqual(['delta'])
  })

  test('returning to a workspace keeps its cache: the held slice of the other one never evicts it', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.listing.resolve(documents({ n1: 100, n2: 200, n3: 300 }))
    await mounted
    await settle()
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    // Leave for a workspace with no cached slice, then come back to a warm one.
    view.hydrate([], 'ws-b')
    view.switchTo('ws-b')
    await settle()
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    view.hydrate([summary('n1', 100), summary('n2', 200), summary('n3', 300)], 'ws')
    view.switchTo('ws')
    // The eviction a pass performs is synchronous: a pass over ws-b's held
    // slice must be dropped, not treated as a census of ws.
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    await settle()
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    expect(notesTaskCache<NoteTask>('ws-b').tasks.size).toBe(0)
    expect(view.workspacesRead()).toEqual([])
  })

  test('a cached slice matching by ids and versions still re-runs the new workspace pass alone', async () => {
    const mounted = view.refreshNotes({ mount: true })
    view.listing.resolve(documents({ n1: 100, n2: 200, n3: 300 }))
    await mounted
    await settle()
    // Mirror workspaces: the new workspace's slice matches the old list by ids
    // and versions, so only the reset effect's kick re-runs the pass.
    view.hydrate([summary('n1', 100), summary('n2', 200), summary('n3', 300)], 'ws-b')
    view.switchTo('ws-b')
    await settle()
    expect(view.workspacesRead()).toEqual(['ws-b', 'ws-b', 'ws-b'])
    expect([...view.readCount]).toEqual([['n1', 1], ['n2', 1], ['n3', 1]])
    view.resolveReads({ n1: 100, n2: 200, n3: 300 })
    await settle()
    expect(notesTaskCache<NoteTask>('ws-b').tasks.size).toBe(3)
    expect(notesTaskCache<NoteTask>('ws').tasks.size).toBe(3)
    expect(taskTexts().sort()).toEqual(['alpha', 'beta', 'gamma'])
  })
})