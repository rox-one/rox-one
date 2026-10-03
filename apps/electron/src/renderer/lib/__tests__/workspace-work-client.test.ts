import { describe, expect, it } from 'bun:test'
import { emptyWorkspaceWorkState, type WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { WorkspaceWorkClient, localDateTimeInput, parseLocalDateTime, workspaceProjectOptions, workspaceWorkFailure, type WorkspaceWorkApi } from '../workspace-work-client'

function snapshot(workspaceId = 'workspace-a', revision = 3): WorkspaceWorkSnapshot {
  return { ...emptyWorkspaceWorkState(workspaceId), revision, access: { actorId: 'owner', canWrite: true, canDelete: true, canManage: true }, members: [{ id: 'owner', name: 'Owner' }], conflicts: [] }
}

function api(overrides: Partial<WorkspaceWorkApi> = {}): WorkspaceWorkApi {
  const result = { snapshot: snapshot(), receipt: { id: 'receipt', workspaceId: 'workspace-a', entityId: 'task', revision: 3, sha256: 'proof', verifiedAt: 1 } }
  return {
    workspaceWorkRead: async () => snapshot(), workspaceWorkWrite: async () => result, workspaceWorkDelete: async () => result,
    workspaceWorkSnapshotProfile: async () => null, onWorkspaceWorkChanged: () => () => {}, ...overrides,
  }
}

describe('workspace work canonical client', () => {
  it('binds each read and write to the requested workspace and explicit revision', async () => {
    const calls: unknown[] = []
    const client = new WorkspaceWorkClient(api({
      workspaceWorkRead: async workspaceId => { calls.push(workspaceId); return snapshot(workspaceId) },
      workspaceWorkWrite: async (workspaceId, input) => { calls.push({ workspaceId, input }); return { snapshot: snapshot(workspaceId, 4), receipt: { id: 'r', workspaceId, entityId: 'task', revision: 4, sha256: 'hash', verifiedAt: 1 } } },
    }), 'workspace-a')
    expect((await client.read()).workspaceId).toBe('workspace-a')
    expect((await client.write(3, { kind: 'createTask', input: { title: 'Real task' } })).snapshot.revision).toBe(4)
    expect(calls).toEqual(['workspace-a', { workspaceId: 'workspace-a', input: { kind: 'createTask', input: { title: 'Real task' }, expectedRevision: 3 } }])
  })

  it('rejects a successful transport response from a different workspace', async () => {
    const client = new WorkspaceWorkClient(api({ workspaceWorkRead: async () => snapshot('workspace-b') }), 'workspace-a')
    await expect(client.read()).rejects.toThrow('requested scope')
  })

  it('leaves a stale mutation rejected and never retries it automatically', async () => {
    let writes = 0
    const client = new WorkspaceWorkClient(api({ workspaceWorkWrite: async () => { writes++; throw new Error('workspace-work-revision-conflict') } }), 'workspace-a')
    try { await client.write(2, { kind: 'updateTask', id: 'task', patch: { title: 'Draft remains' } }) } catch (error) {
      expect(workspaceWorkFailure(error).code).toBe('conflict')
    }
    expect(writes).toBe(1)
  })

  it('dispatches only events belonging to its workspace and releases the actual subscription', () => {
    let listener: ((workspaceId: string, revision: number) => void) | undefined
    let released = false
    const client = new WorkspaceWorkClient(api({ onWorkspaceWorkChanged: callback => { listener = callback; return () => { released = true } } }), 'workspace-a')
    const revisions: number[] = []
    const off = client.subscribe(revision => revisions.push(revision))
    listener?.('workspace-b', 20); listener?.('workspace-a', 4)
    expect(revisions).toEqual([4])
    off(); expect(released).toBe(true)
  })

  it('keeps a missing default profile missing and denies profile snapshots from another workspace', async () => {
    expect(await new WorkspaceWorkClient(api(), 'workspace-a').snapshotProfile()).toBeNull()
    const client = new WorkspaceWorkClient(api({ workspaceWorkSnapshotProfile: async () => ({ profileId: 'p', workspaceId: 'workspace-b', revision: 1, name: 'Profile', role: 'Role', sourceSlugs: [], skillSlugs: [], memoryScope: 'none', automationEnabled: false, capturedAt: 1 }) }), 'workspace-a')
    await expect(client.snapshotProfile('p')).rejects.toThrow('requested workspace')
  })

  it('uses only named project options from the active workspace in the untyped project transport', () => {
    expect(workspaceProjectOptions([
      { workspaceId: 'workspace-a', config: { id: 'project-a', name: 'Active project' } },
      { workspaceId: 'workspace-b', config: { id: 'project-b', name: 'Foreign project' } },
      { workspaceId: 'workspace-a', config: { id: 'broken' } }, null,
    ], 'workspace-a')).toEqual([{ id: 'project-a', name: 'Active project' }])
    expect(() => workspaceProjectOptions({ projects: [] }, 'workspace-a')).toThrow('not a list')
  })

  it('round-trips local appointment inputs without an implicit UTC offset and clears empty deadlines', () => {
    const date = new Date(2026, 9, 3, 15, 45)
    expect(localDateTimeInput(date.getTime())).toBe('2026-10-03T15:45')
    expect(parseLocalDateTime(localDateTimeInput(date.getTime()))).toBe(date.getTime())
    expect(parseLocalDateTime('')).toBeNull()
    expect(parseLocalDateTime('invalid')).toBeNull()
    expect(localDateTimeInput(null)).toBe('')
  })
})
