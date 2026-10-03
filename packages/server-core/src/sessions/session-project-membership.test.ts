import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession, sessionPersistenceQueue } from '@rox/shared/sessions'
import { createManagedSession, managedToSession, SessionManager } from './SessionManager.ts'

const roots: string[] = []
afterEach(async () => { await sessionPersistenceQueue.flushAll(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture(workspaceId: string, manager: SessionManager, ids: string[]) {
  const rootPath = mkdtempSync(join(tmpdir(), 'rox-manager-membership-')); roots.push(rootPath)
  const workspace = { id: workspaceId, name: workspaceId, slug: workspaceId, rootPath, createdAt: 1 }
  const stored = await createSession(rootPath, { projectIds: ids })
  const managed = createManagedSession(stored, workspace, { messagesLoaded: true })
  ;(manager as unknown as { sessions: Map<string, typeof managed> }).sessions.set(managed.id, managed)
  return { rootPath, managed }
}

it('uses the real SessionManager setter and primary compatibility event, then survives reload', async () => {
  const manager = new SessionManager()
  const events: unknown[] = []
  ;(manager as unknown as { sendEvent: (event: unknown) => void }).sendEvent = event => events.push(event)
  const f = await fixture('workspace-a', manager, ['p1', 'p2'])
  expect(managedToSession(f.managed).projectIds).toEqual(['p1', 'p2'])
  await manager.setSessionProjectId(f.managed.id, 'p3')
  expect(loadSession(f.rootPath, f.managed.id)).toMatchObject({ projectId: 'p3', projectIds: ['p3'] })
  expect(events).toContainEqual({ type: 'project_id_changed', sessionId: f.managed.id, projectId: 'p3', projectIds: ['p3'] })
  await manager.setSessionProjectId(f.managed.id, null)
  expect(loadSession(f.rootPath, f.managed.id)?.projectIds).toEqual([])
  expect(managedToSession(f.managed).projectId).toBeUndefined()
})

it('unlinks through the live owner only in the target workspace and never resurrects on later saves', async () => {
  const manager = new SessionManager()
  const first = await fixture('workspace-a', manager, ['p1', 'p2'])
  const other = await fixture('workspace-b', manager, ['p1', 'p2'])
  expect(await manager.unlinkProjectFromSessions('workspace-a', 'p1')).toBe(1)
  expect(managedToSession(first.managed)).toMatchObject({ projectId: 'p2', projectIds: ['p2'] })
  await manager.setSessionLabels(first.managed.id, ['after-delete'])
  expect(loadSession(first.rootPath, first.managed.id)).toMatchObject({ projectId: 'p2', projectIds: ['p2'] })
  expect(loadSession(other.rootPath, other.managed.id)?.projectIds).toEqual(['p1', 'p2'])
})

it('current bulk project replacement replaces the full metadata set', async () => {
  const manager = new SessionManager()
  const f = await fixture('workspace-a', manager, ['p1', 'p2'])
  const result = await manager.bulkUpdateSessions('workspace-a', { ids: [f.managed.id], patch: { projectId: 'p3' } })
  expect(result.ok).toEqual([f.managed.id])
  expect(loadSession(f.rootPath, f.managed.id)).toMatchObject({ projectId: 'p3', projectIds: ['p3'] })
})
