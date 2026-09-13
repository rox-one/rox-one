import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAccountRegistered } from '@craft-agent/core/rox2'
import {
  createOfflineFirstResult,
  createStorageAdapter,
  FIRST_RESULT_ARTIFACTS_KEY,
  FIRST_RESULT_STORAGE_KEY,
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
})
