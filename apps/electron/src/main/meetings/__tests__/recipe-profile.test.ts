import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMeetingStore } from '../local-store'
import { applyPatch, normalizeMeeting } from '../local-model'
test('selected analysis profile persists through the actual local Meeting store and restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'meeting-recipe-profile-'))
  try {
    const store = new LocalMeetingStore({ root, emit: () => {}, detectEngine: () => ({ ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: [] }) })
    const meeting = store.create({ title: 'Call', workspaceId: 'ws' })
    expect(store.update(meeting.id, { recipeId: 'design-review' })?.recipeId).toBe('design-review')
    const restarted = new LocalMeetingStore({ root, emit: () => {}, detectEngine: () => ({ ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: [] }) })
    expect(restarted.read(meeting.id)?.recipeId).toBe('design-review')
    expect(restarted.update(meeting.id, { recipeId: 'untrusted-profile' } as any)?.recipeId).toBe('design-review')
    const legacy = normalizeMeeting({ ...meeting, recipeId: 'untrusted-profile' }, meeting.id)!
    expect(legacy.recipeId).toBeUndefined()
    expect(applyPatch(legacy, { recipeId: 'standup' }, 1).recipeId).toBe('standup')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
