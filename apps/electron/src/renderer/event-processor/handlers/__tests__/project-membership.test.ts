import { expect, it } from 'bun:test'
import { handleProjectIdChanged } from '../session.ts'
import type { SessionState } from '../../types.ts'

const state = { session: { id: 's', projectId: 'p1', projectIds: ['p1', 'p2'], messages: [] }, streaming: null } as unknown as SessionState
it('current project event updates both primary and full grouping metadata', () => {
  const next = handleProjectIdChanged(state, { type: 'project_id_changed', sessionId: 's', projectId: 'p3', projectIds: ['p3', 'p4'] })
  expect(next.state.session.projectId).toBe('p3')
  expect(next.state.session.projectIds).toEqual(['p3', 'p4'])
  expect(next.effects).toEqual([])
})
it('legacy event payload keeps primary replacement and clear semantics', () => {
  expect(handleProjectIdChanged(state, { type: 'project_id_changed', sessionId: 's', projectId: 'p3' }).state.session.projectIds).toEqual(['p3'])
  expect(handleProjectIdChanged(state, { type: 'project_id_changed', sessionId: 's', projectId: null }).state.session.projectIds).toEqual([])
})
