import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('meeting knowledge notes seam (issue 371)', () => {
  test('canonical Notes helper stores a stable entity id, not a second knowledge database', () => {
    const notes = readFileSync(join(import.meta.dir, '../../handlers/rpc/notes.ts'), 'utf8')
    expect(notes).toContain('export async function applyMeetingKnowledgeNoteChange')
    expect(notes).toContain('roxEntityId')
    expect(notes).toContain('roxRevision')
    expect(notes).not.toContain('localStorage')
  })
})
