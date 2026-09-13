import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { createNativeNotesEngine, createNotesRepository } from '@craft-agent/core/rox2'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist.ts'
import { MeetingNotePersistStore } from '../note-persist.ts'
import { applyNativeMeetingAction, createNativeActionHarness, isNativeNotesEngine, openNativePersistTarget, readbackNative } from '../native-actions.ts'
import { payloadHash } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const tmpDirs: string[] = []

beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'native-task-persist-')))
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  return tmpDirs[tmpDirs.length - 1]!
}

function notesDisk(): MeetingNotePersistStore {
  return new MeetingNotePersistStore(root())
}

function apply(
  proposal: MeetingProposal,
  notes: ReturnType<typeof createNativeNotesEngine>,
  tasks: PersonalTaskStore,
  seen: Set<string>,
  persist: PersonalTaskPersistStore,
  notesPersist = notesDisk(),
) {
  return applyNativeMeetingAction(proposal, notes, tasks, seen, persist, notesPersist)
}

function read(
  entityId: string,
  notes: ReturnType<typeof createNativeNotesEngine>,
  tasks: PersonalTaskStore,
  persist: PersonalTaskPersistStore,
  notesPersist = notesDisk(),
) {
  return readbackNative(entityId, notes, tasks, persist, notesPersist)
}

describe('native meeting actions (RMA-I011)', () => {
  test('writes a native task through persist, readback, and double approval does not duplicate', () => {
    const notes = createNativeNotesEngine()
    const tasks = new PersonalTaskStore()
    const persist = new PersonalTaskPersistStore(root())
    const seen = new Set<string>()
    const payload = { title: 'прототип', dueAt: Date.parse('2026-09-18T00:00:00Z') }
    const proposal: MeetingProposal = {
      id: 'p1',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
      payloadHash: payloadHash(payload),
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }
    const first = apply(proposal, notes, tasks, seen, persist)
    const second = apply(proposal, notes, tasks, seen, persist)
    expect(first.entityId).toBe(second.entityId)
    expect(first.revision).toBe(second.revision)
    expect(tasks.list()).toHaveLength(1)
    expect(persist.list()).toHaveLength(1)
    expect(read(first.entityId, notes, tasks, persist)?.entityId).toBe(first.entityId)
    expect(first.entityId.startsWith('task:')).toBe(true)
    expect(first.revision).not.toBe('')
    expect(Number(first.revision)).toBeGreaterThan(0)
    expect(read(first.entityId, notes, tasks, persist)?.revision).toBe(first.revision)
    expect(proposal.payload.entityId).toBeUndefined()
    expect(proposal.payload.revision).toBeUndefined()
  })

  test('task persist round-trip survives store reopen and title update bumps revision', () => {
    const notes = createNativeNotesEngine()
    const tasks = new PersonalTaskStore()
    const persist = new PersonalTaskPersistStore(root())
    const seen = new Set<string>()
    const created = apply({
      id: 'p-create',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload: { title: 'Buy milk' },
      payloadHash: 'x',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }, notes, tasks, seen, persist)
    expect(Number(created.revision)).toBeGreaterThan(0)
    const taskId = created.entityId.replace(/^task:/, '')
    expect(existsSync(join(persist.dir, `${taskId}.json`))).toBe(true)

    const restartedPersist = new PersonalTaskPersistStore(root())
    const emptyMemory = new PersonalTaskStore()
    const afterRestart = read(created.entityId, notes, emptyMemory, restartedPersist)
    expect(afterRestart?.entityId).toBe(created.entityId)
    expect(afterRestart?.revision).toBe(created.revision)

    const updated = apply({
      id: 'p-update',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload: { entityId: created.entityId, title: 'Buy oat milk' },
      payloadHash: 'y',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }, notes, emptyMemory, new Set<string>(), restartedPersist)
    expect(updated.entityId).toBe(created.entityId)
    expect(Number(updated.revision)).toBeGreaterThan(Number(created.revision))
    expect(updated.revision).not.toBe('1')
    expect(restartedPersist.get(taskId)?.task.title).toBe('Buy oat milk')
    expect(read(created.entityId, notes, emptyMemory, restartedPersist)?.revision).toBe(updated.revision)
  })

  test('note write/readback persists NativeNotesEngine revision to disk', () => {
    const notes = createNativeNotesEngine()
    const tasks = new PersonalTaskStore()
    const persist = new PersonalTaskPersistStore(root())
    const notesPersist = notesDisk()
    const seen = new Set<string>()
    const proposal: MeetingProposal = {
      id: 'n1',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_note',
      payload: { title: 'Minutes', body: 'ok' },
      payloadHash: 'x',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }
    const written = apply(proposal, notes, tasks, seen, persist, notesPersist)
    const duplicate = apply(proposal, notes, tasks, seen, persist, notesPersist)
    expect(duplicate.entityId).toBe(written.entityId)
    expect(duplicate.revision).toBe(written.revision)
    expect(notes.list()).toHaveLength(1)
    const stored = notes.read('meeting-n1')
    expect(stored).not.toBeNull()
    expect(stored?.title).toBe('Minutes')
    expect(stored?.markdown).toContain('ok')
    expect(written.entityId).toBe('note:meeting-n1')
    expect(written.revision).toBe(stored!.revision)
    expect(written.revision).not.toBe('1')
    expect(written.revision.length).toBeGreaterThan(0)
    expect(existsSync(join(notesPersist.dir, 'meeting-n1.json'))).toBe(true)
    const seenRead = read(written.entityId, notes, tasks, persist, notesPersist)
    expect(seenRead?.entityId).toBe(written.entityId)
    expect(seenRead?.revision).toBe(written.revision)

    const emptyEngine = createNativeNotesEngine()
    const reopened = new MeetingNotePersistStore(root())
    const fromDisk = read(written.entityId, emptyEngine, tasks, persist, reopened)
    expect(fromDisk?.revision).toBe(written.revision)
    const harness = createNativeActionHarness(root())
    expect(harness.notes.read('meeting-n1')?.markdown).toContain('ok')
    expect(harness.notes.read('meeting-n1')?.revision).toBe(written.revision)
    expect(tasks.exportJson()).toContain('"tasks": []')
    expect(persist.list()).toEqual([])
    expect(notesPersist.list()).toHaveLength(1)
    expect(proposal.payload.entityId).toBeUndefined()
    expect(proposal.payload.revision).toBeUndefined()
  })

  test('harness is a NativeNotesEngine with a persist store, not a NotesRepository Map', () => {
    const harness = createNativeActionHarness(root())
    expect(isNativeNotesEngine(harness.notes)).toBe(true)
    expect(isNativeNotesEngine(createNotesRepository())).toBe(false)
    expect(harness.persist).toBeInstanceOf(PersonalTaskPersistStore)
    expect(harness.notesPersist).toBeInstanceOf(MeetingNotePersistStore)
  })

  test('openNativePersistTarget fail-closes without grant, configDir, revision, or persist hit', () => {
    const persistRootDir = root()
    const harness = createNativeActionHarness(persistRootDir)
    const grant: MeetingGrant = {
      id: 'g',
      actorId: 'user',
      workspaceId: 'ws',
      deviceId: 'dev',
      capabilities: ['send'],
    }
    const created = apply({
      id: 'p-open',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload: { title: 'прототип' },
      payloadHash: 'x',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }, harness.notes, harness.tasks, harness.seen, harness.persist, harness.notesPersist)
    expect(openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      entityId: created.entityId,
      revisionId: created.revision,
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(openNativePersistTarget({
      persistRootDir: null,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: created.entityId,
      revisionId: created.revision,
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })).toEqual({ ok: false, code: 'config-dir-required' })
    expect(openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: created.entityId,
      revisionId: '',
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })).toEqual({ ok: false, code: 'revision-required' })
    expect(openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: 'mail-thread:t1',
      revisionId: created.revision,
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })).toEqual({ ok: false, code: 'unsupported-native-kind' })
    expect(openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: created.entityId,
      revisionId: 'nope',
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })).toEqual({ ok: false, code: 'persist-miss' })
    const opened = openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: created.entityId,
      revisionId: created.revision,
      notes: harness.notes,
      tasks: harness.tasks,
      persist: harness.persist,
      notesPersist: harness.notesPersist,
    })
    expect(opened).toEqual({
      ok: true,
      kind: 'task',
      id: created.entityId.replace(/^task:/, ''),
      revisionId: created.revision,
      entityId: created.entityId,
    })
    const noteWritten = apply({
      id: 'n-open',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_note',
      payload: { title: 'Minutes', body: 'ok' },
      payloadHash: 'x',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }, harness.notes, harness.tasks, harness.seen, harness.persist, harness.notesPersist)
    const restarted = createNativeActionHarness(persistRootDir)
    expect(openNativePersistTarget({
      persistRootDir,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      entityId: noteWritten.entityId,
      revisionId: noteWritten.revision,
      notes: restarted.notes,
      tasks: restarted.tasks,
      persist: restarted.persist,
      notesPersist: restarted.notesPersist,
    })).toEqual({
      ok: true,
      kind: 'note',
      id: 'meeting-n-open',
      revisionId: noteWritten.revision,
      entityId: noteWritten.entityId,
    })
  })
})
