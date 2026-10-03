import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, listSessions, loadSession, saveSession, setSessionProjectId, setSessionProjectIds, unbindProjectFromSessions, updateSessionMetadata } from '../storage.ts'
import { sessionBelongsToProject, sessionProjectIds, withProjectMembership } from '../membership.ts'
import { filterSessionMeta } from '../collection-query.ts'
import { sessionPersistenceQueue } from '../persistence-queue.ts'
import { writeSessionJsonl } from '../jsonl.ts'
import { getSessionFilePath } from '../storage.ts'

const roots: string[] = []
afterEach(async () => { await sessionPersistenceQueue.flushAll(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const root = () => { const path = mkdtempSync(join(tmpdir(), 'rox-project-membership-')); roots.push(path); return path }

describe('session project membership persistence', () => {
  it('normalizes primary-first metadata without treating it as permission', () => {
    expect(sessionProjectIds({ projectId: 'p1', projectIds: ['p2', 'p1', '', 'p2'] })).toEqual(['p1', 'p2'])
    expect(withProjectMembership(['p2', 'p1', 'p2'])).toEqual({ projectId: 'p2', projectIds: ['p2', 'p1'] })
    expect(withProjectMembership([])).toEqual({ projectId: undefined, projectIds: [] })
    expect(sessionBelongsToProject({ projectId: 'legacy' }, 'legacy')).toBe(true)
  })

  it('retains memberships through actual create, reload, list and unrelated metadata writes', async () => {
    const workspace = root()
    const created = await createSession(workspace, { name: 'Multi', projectId: 'p1', projectIds: ['p2', 'p1'] })
    expect(loadSession(workspace, created.id)?.projectIds).toEqual(['p1', 'p2'])
    expect(listSessions(workspace).find(item => item.id === created.id)?.projectIds).toEqual(['p1', 'p2'])
    await updateSessionMetadata(workspace, created.id, { name: 'Renamed' })
    expect(loadSession(workspace, created.id)?.projectIds).toEqual(['p1', 'p2'])
    await setSessionProjectId(workspace, created.id, 'p3')
    expect(loadSession(workspace, created.id)).toMatchObject({ projectId: 'p3', projectIds: ['p3'] })
    await setSessionProjectId(workspace, created.id, null)
    expect(loadSession(workspace, created.id)?.projectId).toBeUndefined()
    expect(loadSession(workspace, created.id)?.projectIds).toEqual([])
  })

  it('unlinks a secondary or primary project without removing the session or transcript', async () => {
    const workspace = root()
    const created = await createSession(workspace, { projectIds: ['p1', 'p2', 'p3'] })
    const stored = loadSession(workspace, created.id)!
    stored.messages.push({ id: 'message', type: 'user', content: 'Keep transcript', timestamp: 1 })
    await saveSession(stored)
    expect(await unbindProjectFromSessions(workspace, 'p2')).toBe(1)
    expect(loadSession(workspace, created.id)).toMatchObject({ projectId: 'p1', projectIds: ['p1', 'p3'] })
    expect(await unbindProjectFromSessions(workspace, 'p1')).toBe(1)
    const reloaded = loadSession(workspace, created.id)!
    expect(reloaded.projectId).toBe('p3')
    expect(reloaded.projectIds).toEqual(['p3'])
    expect(reloaded.messages[0]?.content).toBe('Keep transcript')
    expect(await unbindProjectFromSessions(workspace, 'absent')).toBe(0)
  })

  it('matches current collection project filters against any metadata membership', () => {
    const meta = { id: 'same-session', projectId: 'p1', projectIds: ['p1', 'p2'] }
    expect(filterSessionMeta(meta, { projectId: ['p2'] }, true)).toBe(true)
    expect(filterSessionMeta(meta, { projectId: ['p3'] }, true)).toBe(false)
  })

  it('does not resurrect externally removed edges through a stale pending write', async () => {
    const workspace = root()
    const created = await createSession(workspace, { projectIds: ['p1', 'p2'] })
    const stale = loadSession(workspace, created.id)!
    sessionPersistenceQueue.enqueue({ ...stale, messages: [{ id: 'new', type: 'user', content: 'New message', timestamp: 2 }] })
    // A separate metadata writer changes the disk header while this owner has a pending snapshot.
    writeSessionJsonl(getSessionFilePath(workspace, created.id), { ...stale, projectId: 'p1', projectIds: ['p1'] })
    await sessionPersistenceQueue.flush(created.id)
    const persisted = loadSession(workspace, created.id)!
    expect(persisted.projectIds).toEqual(['p1'])
    expect(persisted.messages[0]?.id).toBe('new')
  })
})
