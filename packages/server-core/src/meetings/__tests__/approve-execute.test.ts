import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist.ts'
import { approveAndExecuteNative } from '../approve-execute.ts'
import { createNativeActionHarness, readbackNative } from '../native-actions.ts'
import { payloadHash, type ProposalStore } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { OutboxJob } from '../executor.ts'

const tmpDirs: string[] = []

beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'approve-execute-')))
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  return tmpDirs[tmpDirs.length - 1]!
}

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

function proposed(partial: Partial<MeetingProposal> = {}): MeetingProposal {
  const payload = { title: 'прототип' }
  return {
    id: 'p1',
    workspaceId: 'ws',
    meetingId: 'm1',
    type: 'create_task',
    payload,
    payloadHash: payloadHash(payload),
    status: 'proposed',
    sourceSpans: [],
    baseRevisions: {},
    ...partial,
  }
}

describe('approve then native execute (RMA-I010/I011)', () => {
  test('approve create_task applies persist revision and readback matches', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const jobs: OutboxJob[] = []
    const store: ProposalStore = { items: [proposed()] }
    const payload = { title: 'прототип' }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload,
      jobs,
      persistRootDir,
      runtime,
    })
    expect(result.proposal.status).toBe('applied')
    expect(result.operation.mode).toBe('fixture')
    expect(result.operation.verification).toBe('pending')
    expect(result.operation.verification).not.toBe('verified')
    expect(result.operation.mode).not.toBe('production')
    expect(result.operation.lifecycle).toBe('succeeded')
    const revision = result.operation.entityRef?.revisionId
    expect(revision).toBeDefined()
    expect(revision).not.toBe('')
    expect(Number(revision)).toBeGreaterThan(0)
    expect(result.operation.receipt?.observedRevision).toBe(revision)
    const entityId = result.operation.entityRef!.entityId
    expect(entityId.startsWith('task:')).toBe(true)
    const taskId = entityId.replace(/^task:/, '')
    expect(existsSync(join(runtime.persist.dir, `${taskId}.json`))).toBe(true)
    expect(readbackNative(entityId, runtime.notes, runtime.tasks, runtime.persist, runtime.notesPersist)?.revision).toBe(revision)

    const restarted = new PersonalTaskPersistStore(persistRootDir)
    const empty = createNativeActionHarness(persistRootDir)
    expect(readbackNative(entityId, empty.notes, empty.tasks, restarted, empty.notesPersist)?.revision).toBe(revision)

    const again = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload,
      jobs,
      persistRootDir,
      runtime,
    })
    expect(again.operation.entityRef?.entityId).toBe(entityId)
    expect(again.operation.entityRef?.revisionId).toBe(revision)
    expect(runtime.persist.list()).toHaveLength(1)
  })

  test('approve create_note persists engine revision and readback survives harness restart', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const jobs: OutboxJob[] = []
    const payload = { title: 'Minutes', body: 'ok' }
    const store: ProposalStore = { items: [proposed({
      id: 'p-note',
      type: 'create_note',
      payload,
      payloadHash: payloadHash(payload),
    })] }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p-note',
      actorId: 'user',
      grant,
      payload,
      jobs,
      persistRootDir,
      runtime,
    })
    expect(result.proposal.status).toBe('applied')
    expect(result.operation.mode).toBe('fixture')
    expect(result.operation.verification).toBe('pending')
    expect(result.operation.verification).not.toBe('verified')
    expect(result.operation.mode).not.toBe('production')
    const entityId = result.operation.entityRef!.entityId
    const revision = result.operation.entityRef!.revisionId
    expect(entityId).toBe('note:meeting-p-note')
    expect(revision).not.toBe('1')
    expect(revision.length).toBeGreaterThan(0)
    expect(existsSync(join(runtime.notesPersist.dir, 'meeting-p-note.json'))).toBe(true)
    expect(readbackNative(entityId, runtime.notes, runtime.tasks, runtime.persist, runtime.notesPersist)?.revision).toBe(revision)
    const empty = createNativeActionHarness(persistRootDir)
    expect(readbackNative(entityId, empty.notes, empty.tasks, empty.persist, empty.notesPersist)?.revision).toBe(revision)
    expect(runtime.persist.list()).toEqual([])
    expect(runtime.notesPersist.list()).toHaveLength(1)
  })

  test('grant missing is fail-closed: proposed stays, persist empty', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const store: ProposalStore = { items: [proposed()] }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant: null,
      payload: { title: 'прототип' },
      jobs: [],
      persistRootDir,
      runtime,
    })
    expect(result.proposal.status).toBe('proposed')
    expect(result.operation.error?.code).toBe('grant-required')
    expect(result.operation.entityRef).toBeUndefined()
    expect(runtime.persist.list()).toEqual([])
    expect(runtime.notesPersist.list()).toEqual([])
  })

  test('missing configDir does not apply after approve', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const store: ProposalStore = { items: [proposed()] }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload: { title: 'прототип' },
      jobs: [],
      persistRootDir: null,
      runtime,
    })
    expect(result.proposal.status).toBe('approved')
    expect(result.operation.error?.code).toBe('config-dir-required')
    expect(result.operation.entityRef).toBeUndefined()
    expect(runtime.persist.list()).toEqual([])
    expect(runtime.notesPersist.list()).toEqual([])
  })

  test('missing outbox does not apply after approve', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const store: ProposalStore = { items: [proposed()] }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload: { title: 'прототип' },
      jobs: null,
      persistRootDir,
      runtime,
    })
    expect(result.proposal.status).toBe('approved')
    expect(result.operation.error?.code).toBe('outbox-required')
    expect(runtime.persist.list()).toEqual([])
    expect(runtime.notesPersist.list()).toEqual([])
  })

  test('revoked grant does not apply', () => {
    const persistRootDir = root()
    const runtime = createNativeActionHarness(persistRootDir)
    const store: ProposalStore = { items: [proposed()] }
    const result = approveAndExecuteNative({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant: { ...grant, revokedAt: 1 },
      payload: { title: 'прототип' },
      jobs: [],
      persistRootDir,
      runtime,
    })
    expect(result.proposal.status).toBe('proposed')
    expect(result.operation.error?.code).toBe('revoked')
    expect(runtime.persist.list()).toEqual([])
    expect(runtime.notesPersist.list()).toEqual([])
  })
})
