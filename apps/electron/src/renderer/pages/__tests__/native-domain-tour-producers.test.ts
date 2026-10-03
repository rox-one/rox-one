import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { deriveKnowledgeSignals, matchesNoteReceipt, openCurrentSearchResult } from '../../features/product-tour/adapters/knowledge'
import { derivePersonalTaskSignals } from '../../features/product-tour/adapters/work/tasks-projects'
import { taskDelegationErrorKey } from '../tasks/delegation-errors'
import type { TourObservation } from '../../features/product-tour/runtime/hooks'

// Execute callbacks from the actual current components. Native transports are
// controlled seams; this verifies ordering/evidence/ownership, not native auth.
function callbacks(path: string, component: string, names: readonly string[], bindings: Record<string, unknown>) {
  const source = readFileSync(join(import.meta.dir, '..', path), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const owner = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === component) as ts.FunctionDeclaration
  if (!owner?.body) throw new Error('Actual producer component missing: ' + component)
  const declarations = owner.body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  const code = names.map(name => {
    const declaration = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name)
    if (!declaration?.initializer) throw new Error('Actual producer callback missing: ' + name)
    return `const ${name} = ${declaration.initializer.getText(ast)};`
  }).join('\n') + `\nreturn { ${names.join(',')} };`
  const executable = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as Record<string, (...args: any[]) => any>
}
const observation: TourObservation = { binding: { workspaceId: 'a', panelId: 'panel', clientProfileId: 'fixture', runToken: 'original-run' }, operationToken: 'operation', at: 1 }
const pending = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const note = { id: 'note', nativeId: 'immutable-note', nativeRevision: 1, revision: 'before', content: 'original' }
const operation = { workspaceId: 'a', nativeId: 'immutable-note', operationId: 'accepted-native-operation', expectedRevision: 1 }
const receipt = { ...operation, revision: 2, sequence: 2, kind: 'notes', issuer: 'fixture-issuer', subject: 'fixture-actor', contentHash: 'hash', deleted: false }

function notesFixture(enabled = true) {
  const signals: unknown[] = []
  let readback: unknown = note, readCalls = 0
  let receipts: unknown[] = [receipt]
  const functions = callbacks('NotesPage.tsx', 'NativeNotesPage', ['createNoteWithEvidence', 'saveNativeNote'], {
    React: { useCallback: (callback: unknown) => callback }, retainedSourceHash: (value: string) => 'hash:' + value,
    matchesNoteReceipt, nativeNotesSync: { queueSave: async () => operation, flush: async () => receipts },
    knowledgeSignals: { capture: () => enabled ? observation : null,
      publish: (captured: TourObservation | null, completion: any) => signals.push(...deriveKnowledgeSignals(captured, completion)) },
    window: { electronAPI: { createNote: async () => note, readNote: async () => { readCalls++; return readback } } },
  })
  return { functions, signals, readCalls: () => readCalls, readback: (value: unknown) => { readback = value }, receipts: (value: unknown[]) => { receipts = value } }
}

describe('actual native Notes creation/save producer evidence', () => {
  test('creation is verified only by exact canonical readback; disabled learning adds no read', async () => {
    const f = notesFixture(); f.readback({ ...note, id: 'foreign' })
    expect(await f.functions.createNoteWithEvidence!('a', 'Private title')).toEqual(note)
    expect(f.signals).toEqual([])
    f.readback(note); await f.functions.createNoteWithEvidence!('a', 'Private title')
    expect(f.signals).toHaveLength(1)
    expect(f.signals[0]).toMatchObject({ name: 'note.created', binding: observation.binding, origin: 'native-commit' })
    expect(JSON.stringify(f.signals)).not.toContain('Private title')
    const off = notesFixture(false); await off.functions.createNoteWithEvidence!('a', 'Private title')
    expect(off.readCalls()).toBe(0); expect(off.signals).toEqual([])
  })
  test('save requires actual matching native ACK; pending/foreign operation yields no completion', async () => {
    const f = notesFixture(); f.receipts([])
    await expect(f.functions.saveNativeNote!(note, 'Private markdown')).rejects.toThrow('remains pending')
    expect(f.signals).toEqual([])
    f.receipts([{ ...receipt, subject: '', revision: 19 }]); await f.functions.saveNativeNote!(note, 'Private markdown')
    expect(f.signals).toEqual([])
    f.receipts([receipt]); await f.functions.saveNativeNote!(note, 'Private markdown')
    expect(f.signals).toHaveLength(1)
    expect(f.signals[0]).toMatchObject({ name: 'note.persisted', eventToken: operation.operationId, binding: observation.binding })
    expect(JSON.stringify(f.signals)).not.toContain('Private markdown')
  })
})

function delegationFixture() {
  const task = new PersonalTaskStore().create({ id: 'task', title: 'Private task', list: 'inbox' })
  const calls: string[] = [], signals: unknown[] = [], errors: unknown[] = []
  const owner = { current: { workspaceId: 'a' as string | undefined, generation: 1, mounted: true, actorGeneration: 1 } }
  const committed = { task: { ...task, links: [{ kind: 'session', id: 'session' }] }, revision: 2 }
  let created = () => Promise.resolve({ id: 'session' })
  let commit = () => Promise.resolve(committed)
  let readback = () => Promise.resolve({ tasks: [committed.task], revisions: { task: 2 } })
  const functions = callbacks('TasksPage.tsx', 'TasksPage', ['delegate'], {
    useCallback: (callback: unknown) => callback,
    mutate: (fn: (cache: { link: () => void }) => void) => { calls.push('optimistic-link'); fn({ link: () => {} }) },
    workspace: { id: 'a' }, shell: { onCreateSession: async () => { calls.push('create'); return created() } },
    delegationInFlight: { current: false }, delegationOwner: owner, personalTasksNativeAvailable: () => true,
    capturePersonalTaskScope: () => { const generation = owner.current.actorGeneration; return () => generation === owner.current.actorGeneration }, taskDelegationErrorKey,
    tour: { capture: () => observation, emit: (captured: TourObservation, name: string, level: string, origin: string, eventToken: string) => signals.push({ captured, name, level, origin, eventToken }) },
    setDelegating: () => {}, setDelegateError: (value: unknown) => errors.push(value),
    storeRef: { current: { list: () => [task] } }, subtasksOf: () => [], buildDelegationPrompt: () => 'Private delegated prompt',
    t: (key: string) => key, projects: [], derivePersonalTaskSignals,
    persistPersonalTaskSessionLink: async () => { calls.push('commit-link'); return commit() },
    window: { electronAPI: {
      sessionCommand: async (_id: string, command: { type: string }) => { calls.push(command.type) },
      sendMessage: async () => { calls.push('send') },
      getSessionMessages: async () => ({ id: 'session', workspaceId: 'a', messages: [{ role: 'user', content: 'Private delegated prompt' }] }),
      personalTasksList: () => readback(),
    } },
  })
  return { task, calls, signals, errors, owner, run: () => functions.delegate!(task), created: (next: typeof created) => { created = next }, commit: (next: typeof commit) => { commit = next }, readback: (next: typeof readback) => { readback = next } }
}

describe('actual task delegation uses durable linkage before work', () => {
  test('successful actual callback orders link before prompt and emits only exact native readback', async () => {
    const f = delegationFixture(); await f.run()
    expect(f.calls).toEqual(['create', 'rename', 'setSessionStatus', 'commit-link', 'send'])
    expect(f.signals).toHaveLength(1); expect(f.signals[0]).toMatchObject({ name: 'personal-task.delegated', origin: 'native-commit' })
    expect(JSON.stringify(f.signals)).not.toContain('Private task')
    const wrong = delegationFixture(); wrong.readback(async () => ({ tasks: [], revisions: { task: 0 } })); await wrong.run()
    expect(wrong.signals).toEqual([])
  })
  test('rejected native linkage prevents prompt and completion', async () => {
    const f = delegationFixture(); f.commit(async () => { throw new Error('Native CAS refused') }); await f.run()
    expect(f.calls).not.toContain('send'); expect(f.signals).toEqual([])
    expect(f.errors).toContain('tasks.delegate.error.unavailable')
    expect(f.errors).not.toContain('Native CAS refused')
  })
  test('same-workspace actor changes after session creation or native linkage cannot submit work', async () => {
    const create = delegationFixture(), created = pending<{ id: string }>(); create.created(() => created.promise)
    const run = create.run(); create.owner.current.actorGeneration++; created.resolve({ id: 'session' }); await run
    expect(create.calls).toEqual(['create']); expect(create.signals).toEqual([])
    const linked = delegationFixture(), link = pending<any>(); linked.commit(() => link.promise)
    const late = linked.run(); await settle(); linked.owner.current.actorGeneration++; link.resolve({ task: linked.task, revision: 2 }); await late
    expect(linked.calls).not.toContain('send'); expect(linked.signals).toEqual([])
  })
  test('workspace roundtrip/unmount after create or native link prevents late work and signals', async () => {
    const create = delegationFixture(), created = pending<{ id: string }>(); create.created(() => created.promise)
    const run = create.run(); create.owner.current.generation += 2; created.resolve({ id: 'session' }); await run
    expect(create.calls).toEqual(['create']); expect(create.signals).toEqual([])
    const linked = delegationFixture(), link = pending<any>(); linked.commit(() => link.promise)
    const late = linked.run(); await settle(); expect(linked.calls).toContain('commit-link')
    linked.owner.current.mounted = false; link.resolve({ task: linked.task, revision: 2 }); await late
    expect(linked.calls).not.toContain('send'); expect(linked.signals).toEqual([])
  })
})

test('actual SearchPage opening rechecks native membership and current query before navigation', async () => {
  const currentQuery = { current: 'q' }, currentWorkspaceId = { current: 'a' }, requestVersion = { current: 1 }
  const read = pending<any[]>(), signals: unknown[] = [], routesOpened: string[] = []
  const functions = callbacks('SearchPage.tsx', 'SearchPage', ['currentOpening', 'openNote'], {
    workspaceId: 'a', query: 'q', currentQuery, currentWorkspaceId, requestVersion, openCurrentSearchResult,
    knowledgeSignals: { capture: () => observation, publish: (captured: TourObservation, completion: any) => signals.push(...deriveKnowledgeSignals(captured, completion)) },
    window: { electronAPI: { searchNotes: () => read.promise } },
    navigateInPanel: (route: string) => routesOpened.push(route), routes: { view: { notes: (id: string) => id } },
  })
  const stale = functions.openNote!({ id: 'owned-note' }); currentQuery.current = 'new'; read.resolve([{ id: 'owned-note' }]); await stale
  expect(routesOpened).toEqual([]); expect(signals).toEqual([])
  currentQuery.current = 'q'; await functions.openNote!({ id: 'foreign-note' }); expect(routesOpened).toEqual([])
  await functions.openNote!({ id: 'owned-note' }); expect(routesOpened).toEqual(['owned-note'])
  expect(signals).toHaveLength(1); expect(signals[0]).toMatchObject({ name: 'search.result-opened', binding: observation.binding })
})
