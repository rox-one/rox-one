import { describe, expect, it } from 'bun:test'
import { projectNativeNotesChanged } from '../native-notes-events'

const authority = {
  resolveWorkspace: () => ({ nativeRoot: '/tmp/notes' }),
  authorize: () => true,
}

const principal = { kind: 'local' } as never

describe('projectNativeNotesChanged', () => {
  it('allows templates and comments reasons from NoteChangedPayload', () => {
    for (const reason of ['templates', 'comments'] as const) {
      const out = projectNativeNotesChanged(authority as never, [{ workspaceId: 'ws', reason }], 'ws', principal)
      expect(out).toEqual([{ workspaceId: 'ws', reason }])
    }
  })

  it('rejects reasons outside the allowlist', () => {
    expect(projectNativeNotesChanged(
      authority as never,
      [{ workspaceId: 'ws', reason: 'not-a-reason' }],
      'ws',
      principal,
    )).toBeNull()
  })
})
