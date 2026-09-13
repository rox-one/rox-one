import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAccountRegistered } from '@craft-agent/core/rox2'
import {
  createDefaultFirstResultPorts,
  createOfflineFirstResult,
  createStorageAdapter,
  FIRST_RESULT_ARTIFACTS_KEY,
  FIRST_RESULT_IMPORT_SKIPPED,
  FIRST_RESULT_STORAGE_KEY,
  isFirstResultImportSkipped,
  loadFirstResultArtifacts,
  rememberLocalProfile,
  retryFirstResultServices,
  skipFirstResultOnStore,
  skipSetupLandingStep,
  type FirstResultCopy,
} from '../first-result-ui.ts'

function memoryStorage(seed: Record<string, string> = {}) {
  const data = { ...seed }
  return {
    getItem(key: string) {
      return data[key] ?? null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
    snapshot: () => data,
  }
}

const COPY: FirstResultCopy = {
  noteTitle: 'onboarding.completion.firstResultCreate',
  noteBody: 'onboarding.completion.firstResultHint',
  outcomeTitle: 'onboarding.completion.firstResultReady',
  taskTitle: 'onboarding.completion.firstResultCreate',
}

describe('ROX-P1-ONBOARDING-UI first-result (evidence U1)', () => {
  test('skipping provider setup still lands on the first-result step', () => {
    expect(skipSetupLandingStep()).toBe('complete')
  })

  test('offline seed writes usable note and task artifacts and completes', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const checkpoint = await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: { now: () => 1 },
    })
    const artifacts = loadFirstResultArtifacts(storage)
    expect(checkpoint.step).toBe('complete')
    expect(checkpoint.skipped).toBe(false)
    expect(artifacts?.note.id).toBe(checkpoint.noteId)
    expect(artifacts?.task.id).toBe(checkpoint.taskId)
    expect(artifacts?.note.title).toBe(COPY.noteTitle)
    expect(artifacts?.task.title).toBe(COPY.taskTitle)
    expect(storage.snapshot()[FIRST_RESULT_STORAGE_KEY]).toContain('"step":"complete"')
    expect(storage.snapshot()[FIRST_RESULT_ARTIFACTS_KEY]).toContain(COPY.noteTitle)
  })

  test('import failure records error but still completes the chain', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const checkpoint = await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 2,
        importNotes: async () => {
          throw new Error('import-refused')
        },
      },
    })
    expect(checkpoint.step).toBe('complete')
    expect(checkpoint.skipped).toBe(false)
    expect(checkpoint.error).toBe('import-refused')
    expect(loadFirstResultArtifacts(storage)?.note.id).toBe(checkpoint.noteId)
  })

  test('note persist failure still keeps offline artifacts', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const checkpoint = await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 3,
        persistNote: async () => {
          throw new Error('notes-unavailable')
        },
      },
    })
    expect(checkpoint.step).toBe('complete')
    expect(checkpoint.error).toBe('notes-unavailable')
    expect(loadFirstResultArtifacts(storage)?.task.id).toBe(checkpoint.taskId)
  })

  test('local profile name is not account registration', () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const checkpoint = rememberLocalProfile(store, 'Ada')
    expect(checkpoint.localProfileName).toBe('Ada')
    expect(isAccountRegistered(checkpoint)).toBe(false)
  })

  test('retry clears import error after import succeeds', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 4,
        importNotes: async () => {
          throw new Error('import-refused')
        },
      },
    })
    const retried = await retryFirstResultServices(store, storage, {
      importNotes: async () => undefined,
    })
    expect(retried.step).toBe('complete')
    expect(retried.error).toBeUndefined()
  })

  test('skip still completes without claiming a first result', () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const skipped = skipFirstResultOnStore(store)
    expect(skipped.step).toBe('complete')
    expect(skipped.skipped).toBe(true)
    expect(loadFirstResultArtifacts(storage)).toBeNull()
  })

  test('create path does not send a message, capture mic, or spend', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    const calls: string[] = []
    await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 5,
        persistNote: async () => {
          calls.push('persistNote')
        },
        persistTask: async () => {
          calls.push('persistTask')
        },
        importNotes: async () => {
          calls.push('importNotes')
        },
      },
    })
    expect(calls).toEqual(['persistNote', 'persistTask', 'importNotes'])
    const source = readFileSync(join(import.meta.dir, '../first-result-ui.ts'), 'utf8')
    expect(source).not.toContain('sendMessage(')
    expect(source).not.toContain('getUserMedia')
    expect(source).not.toContain('createTask(')
    expect(source).not.toContain('evaluateReleaseGate')
  })

  test('persistNote writes note body via saveNote, not title-only createNote', async () => {
    const calls: Array<{ op: string; args: unknown[] }> = []
    const ports = createDefaultFirstResultPorts({
      getWorkspaces: async () => [{ id: 'ws-1' }],
      createNote: async (workspaceId, title) => {
        calls.push({ op: 'createNote', args: [workspaceId, title] })
        return { id: 'n1', content: '---\ntitle: Hello\n---\n' }
      },
      saveNote: async (workspaceId, noteId, content, revision) => {
        calls.push({ op: 'saveNote', args: [workspaceId, noteId, content, revision] })
      },
    })
    await ports.persistNote?.({
      id: 'welcome-1',
      title: 'Hello',
      body: 'Get a first result without waiting for every service.',
    })
    expect(calls.map((c) => c.op)).toEqual(['createNote', 'saveNote'])
    expect(calls[1]?.args[0]).toBe('ws-1')
    expect(calls[1]?.args[1]).toBe('n1')
    expect(String(calls[1]?.args[2])).toContain('Get a first result without waiting for every service.')
    expect(typeof calls[1]?.args[3]).toBe('string')
    expect(String(calls[1]?.args[3]).length).toBeGreaterThan(0)
  })

  test('persistNote passes createNote revision as expectedRevision', async () => {
    let expected: string | undefined
    const ports = createDefaultFirstResultPorts({
      getWorkspaces: async () => [{ id: 'ws-1' }],
      createNote: async () => ({ id: 'n1', content: '# Hello\n', revision: 'rev-from-engine' }),
      saveNote: async (_ws, _id, _content, revision) => {
        expected = revision
      },
    })
    await ports.persistNote?.({ id: 'welcome-1', title: 'Hello', body: 'Body' })
    expect(expected).toBe('rev-from-engine')
  })

  test('persistNote refuses a write without a CAS token', async () => {
    const ports = createDefaultFirstResultPorts({
      getWorkspaces: async () => [{ id: 'ws-1' }],
      createNote: async () => ({ id: 'n1' }),
      saveNote: async () => undefined,
    })
    await expect(
      ports.persistNote?.({ id: 'welcome-1', title: 'Hello', body: 'Body must persist' }),
    ).rejects.toMatchObject({ message: 'notes-unavailable' })
  })

  test('persistNote does not succeed as title-only when saveNote is missing', async () => {
    const ports = createDefaultFirstResultPorts({
      getWorkspaces: async () => [{ id: 'ws-1' }],
      createNote: async () => ({ id: 'n1', content: '' }),
    })
    await expect(
      ports.persistNote?.({ id: 'welcome-1', title: 'Hello', body: 'Body must persist' }),
    ).rejects.toBeDefined()
  })

  test('importNotes actually imports when a folder is chosen', async () => {
    const migrateArgs: unknown[] = []
    const ports = createDefaultFirstResultPorts({
      getWorkspaces: async () => [{ id: 'ws-1' }],
      openFolderDialog: async () => '/notes-root',
      knowledge: {
        migrateNotes: async (args) => {
          migrateArgs.push(args)
          return { migrated: 2, skipped: 0, failed: [] }
        },
      },
    })
    await ports.importNotes?.()
    expect(migrateArgs).toEqual([
      { workspaceId: 'ws-1', sourceRoot: '/notes-root', format: 'craft-markdown' },
    ])
  })

  test('importNotes labels missing or cancelled import as skipped, not a silent success', async () => {
    await expect(createDefaultFirstResultPorts({}).importNotes?.()).rejects.toMatchObject({
      message: FIRST_RESULT_IMPORT_SKIPPED,
    })
    await expect(
      createDefaultFirstResultPorts({
        getWorkspaces: async () => [{ id: 'ws-1' }],
        openFolderDialog: async () => null,
        knowledge: {
          migrateNotes: async () => ({ migrated: 0, skipped: 0, failed: [] }),
        },
      }).importNotes?.(),
    ).rejects.toMatchObject({ message: FIRST_RESULT_IMPORT_SKIPPED })
    expect(isFirstResultImportSkipped(FIRST_RESULT_IMPORT_SKIPPED)).toBe(true)
    expect(isFirstResultImportSkipped('import-refused')).toBe(false)
  })

  test('retry of a no-op import is labeled skipped instead of clearing the error', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 6,
        importNotes: async () => {
          throw new Error('import-refused')
        },
      },
    })
    const retried = await retryFirstResultServices(
      store,
      storage,
      createDefaultFirstResultPorts({
        getWorkspaces: async () => [{ id: 'ws-1' }],
      }),
    )
    expect(retried.step).toBe('complete')
    expect(retried.error).toBe(FIRST_RESULT_IMPORT_SKIPPED)
    expect(isFirstResultImportSkipped(retried.error)).toBe(true)
  })

  test('retry with migrateNotes actually imports and clears the import error', async () => {
    const storage = memoryStorage()
    const store = createStorageAdapter(storage)
    await createOfflineFirstResult(store, storage, {
      copy: COPY,
      ports: {
        now: () => 7,
        importNotes: async () => {
          throw new Error('import-refused')
        },
      },
    })
    let imported = false
    const retried = await retryFirstResultServices(
      store,
      storage,
      createDefaultFirstResultPorts({
        getWorkspaces: async () => [{ id: 'ws-1' }],
        openFolderDialog: async () => '/notes-root',
        knowledge: {
          migrateNotes: async () => {
            imported = true
            return { migrated: 1, skipped: 0, failed: [] }
          },
        },
      }),
    )
    expect(imported).toBe(true)
    expect(retried.error).toBeUndefined()
  })
})
