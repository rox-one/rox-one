import { expect, test } from 'bun:test'
import type { Session, SessionEvent } from '@rox/shared/protocol'
import { filterSessionMeta } from '@rox/shared/sessions/collection'
import { nativeSession, nativeSessionEvent } from '../native-session-scope'

const session = (membership: Record<string, unknown> = {}) => ({
  id: 'session-a', workspaceId: 'workspace-a', lastMessageAt: 1, isProcessing: false,
  messages: [{ id: 'message-a', role: 'user', content: 'Keep this transcript', timestamp: 1 }],
  sessionFolderPath: '/host/private/session', ...membership,
}) as Session

test('native projection keeps primary-first secondary memberships for collection filters', () => {
  const original = session({ projectId: 'p1', projectIds: ['p2', 'p1', 'p2'] })
  const projected = nativeSession(original)
  expect(projected.projectId).toBe('p1')
  expect(projected.projectIds).toEqual(['p1', 'p2'])
  expect(filterSessionMeta(projected, { projectId: ['p2'] }, true)).toBe(true)
  expect(projected.messages).toHaveLength(1)
  expect(projected.sessionFolderPath).toBeUndefined()
  expect(original.projectIds).toEqual(['p2', 'p1', 'p2'])
})

test('native membership supports legacy primary IDs and secondary promotion', () => {
  expect(nativeSession(session({ projectId: 'p1' }))).toMatchObject({ projectId: 'p1', projectIds: ['p1'] })
  expect(nativeSession(session({ projectIds: ['p2', 'p3'] }))).toMatchObject({ projectId: 'p2', projectIds: ['p2', 'p3'] })
  expect(nativeSession(session({ projectIds: [] }))).toMatchObject({ projectIds: [] })
  expect(nativeSession(session()).projectId).toBeUndefined()
  expect(nativeSession(session({ projectId: 'проект.1', projectIds: ['项目_2'] }))).toMatchObject({ projectId: 'проект.1', projectIds: ['проект.1', '项目_2'] })
})

test('native membership strips malformed IDs and host path metadata without mutating storage', () => {
  const projected = nativeSession(session({ projectId: '/host/private/project', projectIds: ['p2', 2, null, {}, '', '../private', 'C:\\host\\private', 'file:///private', 'x'.repeat(129), 'p2'] }))
  expect(projected.projectId).toBe('p2')
  expect(projected.projectIds).toEqual(['p2'])
  expect(JSON.stringify(projected)).not.toContain('private')
  expect(nativeSession(session({ projectId: 'p1', projectIds: { hostPath: '/private' } })).projectIds).toEqual(['p1'])
})

test('native project change emits the normalized pair and strips unrelated host fields', () => {
  const event = { type: 'project_id_changed', sessionId: 'session-a', projectId: 'p1', projectIds: ['p2', 'p1'], hostSecret: '/host/private' } as SessionEvent
  expect(nativeSessionEvent(event)).toEqual({ type: 'project_id_changed', sessionId: 'session-a', projectId: 'p1', projectIds: ['p1', 'p2'] })
  expect(nativeSessionEvent({ type: 'project_id_changed', sessionId: 'session-a', projectId: null, projectIds: [] })).toEqual({ type: 'project_id_changed', sessionId: 'session-a', projectId: null, projectIds: [] })
  expect(nativeSessionEvent({ type: 'project_id_changed', sessionId: 'session-a', projectId: 'p2' })).toEqual({ type: 'project_id_changed', sessionId: 'session-a', projectId: 'p2', projectIds: ['p2'] })
})

test('native project changes reject malformed array shapes and filter path-like IDs', () => {
  expect(nativeSessionEvent({ type: 'project_id_changed', sessionId: 'session-a', projectId: 'p1', projectIds: {} } as unknown as SessionEvent)).toBeNull()
  expect(nativeSessionEvent({ type: 'project_id_changed', sessionId: 'session-a', projectId: '/private', projectIds: ['p2', '../host', null] } as unknown as SessionEvent)).toEqual({ type: 'project_id_changed', sessionId: 'session-a', projectId: 'p2', projectIds: ['p2'] })
  expect(nativeSessionEvent({ type: 'project_id_changed', sessionId: 'session-a', projectId: null, projectIds: null } as unknown as SessionEvent)).toBeNull()
})

test('task promotion metadata projects only its project membership pair', () => {
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { taskDraft: false, taskSlug: 'private-task-slug', projectId: 'p1', projectIds: ['p2', 'p1'] } })).toEqual({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectId: 'p1', projectIds: ['p1', 'p2'] } })
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { taskDraft: false, taskSlug: 'private-task-slug' } })).toBeNull()
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectIds: {} } } as unknown as SessionEvent)).toBeNull()
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectIds: [] } })).toEqual({ type: 'project_id_changed', sessionId: 'session-a', projectId: null, projectIds: [] })
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectId: '/host/private/project', projectIds: [] } })).toBeNull()
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectIds: ['/host/private/project'] } })).toBeNull()
  expect(nativeSessionEvent({ type: 'session_metadata_changed', sessionId: 'session-a', changes: { projectId: 0, projectIds: [] } } as unknown as SessionEvent)).toBeNull()
})
