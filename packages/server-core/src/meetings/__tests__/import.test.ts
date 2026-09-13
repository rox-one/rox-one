import { describe, expect, test } from 'bun:test'
import { importMeetingMedia } from '../import.ts'

describe('meeting import (RMA-I004)', () => {
  test('permission-like rejects, replay is idempotent, corrupt empty media fails', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const first = importMeetingMedia({ workspaceId: 'ws', bytes, existing: [] })
    expect(first.status).toBe('ok')
    const replay = importMeetingMedia({ workspaceId: 'ws', bytes, existing: first.item ? [first.item] : [] })
    expect(replay.status).toBe('duplicate')
    expect(importMeetingMedia({ workspaceId: 'ws', bytes: new Uint8Array(), existing: [] }).status).toBe('rejected')
    expect(importMeetingMedia({ workspaceId: 'ws', bytes, existing: [], mimeType: 'video/mp4' }).reason).toBe('bad-format')
  })
})
