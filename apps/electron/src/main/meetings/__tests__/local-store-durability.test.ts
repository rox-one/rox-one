/**
 * Durability regression for transcript writes: transcript.json / transcript.md
 * must use the same write→fsync→rename→fsync-dir→read-back idiom as meeting.json,
 * so a torn or truncated write surfaces as 'meeting-write-readback-failed'
 * instead of being silently accepted as success.
 *
 * Module-loading-boundary exception: mock.module is process-global and
 * scripts/test-all.ts runs each suite in its own process, so the dynamic
 * import() of the store is required to load it AFTER the fs mock installs —
 * static imports cannot order themselves around mock.module.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const realFs = { ...(await import('node:fs')) }

// Flipped once the store renames a tmp over transcript.json; combined with
// corruptReadback it corrupts exactly the read-back read that writeDurable
// performs immediately after the rename.
let transcriptRenamed = false
let corruptReadback = false

mock.module('node:fs', () => ({
  ...realFs,
  renameSync: (from: string, to: string, ...rest: unknown[]) => {
    const result = (realFs.renameSync as (...args: unknown[]) => unknown)(from, to, ...rest)
    if (String(to).endsWith('transcript.json')) transcriptRenamed = true
    return result
  },
  readFileSync: (path: unknown, ...rest: unknown[]) => {
    const value = (realFs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest)
    if (corruptReadback && transcriptRenamed && String(path).endsWith('transcript.json') && typeof value === 'string') {
      return `${value}corrupted`
    }
    return value
  },
}))

const { LocalMeetingStore } = await import('../local-store')

const NO_ENGINE = { ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: ['no-whisper', 'no-model', 'no-ffmpeg'] }
const roots: string[] = []

afterEach(() => {
  transcriptRenamed = false
  corruptReadback = false
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A store, a stopped recording with audio, and a revision-1 transcript on disk. */
async function recordingMeetingWithTranscript() {
  const root = mkdtempSync(join(tmpdir(), 'rox-meetings-dur-'))
  roots.push(root)
  const store = new LocalMeetingStore({ root, detectEngine: () => NO_ENGINE, emit: () => {} })
  const started = store.recStart({ title: 'Standup', workspaceId: 'w1', mimeType: 'audio/webm', owner: 1 })
  if (!started.ok) throw new Error('recStart failed')
  const id = started.value.id
  store.recChunk(id, new Uint8Array([1, 2, 3]))
  const stopped = await store.recStop(id, { durationMs: 5000 })
  if (!stopped.ok) throw new Error('recStop failed')
  const dir = join(root, id)
  writeFileSync(join(dir, 'transcript.json'), `${JSON.stringify({ revision: 1, createdAt: 0, segments: [{ id: 's0', startMs: 0, endMs: 1000, text: 'hi' }] }, null, 2)}\n`)
  return { store, id, dir }
}

describe('transcript write durability', () => {
  it('writes transcript.json and transcript.md with a verified read-back', async () => {
    const { store, id, dir } = await recordingMeetingWithTranscript()

    const result = await store.updateTranscriptSegment(id, { expectedRevision: 1, segmentId: 's0', patch: { startMs: 100 } })
    expect(result.ok).toBe(true)

    const onDisk = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'))
    expect(onDisk.revision).toBe(2)
    expect(onDisk.segments[0].startMs).toBe(100)
    expect(existsSync(join(dir, 'transcript.md'))).toBe(true)
    expect(readFileSync(join(dir, 'transcript.md'), 'utf8')).toContain('hi')
  })

  it('throws meeting-write-readback-failed when the transcript read-back mismatches', async () => {
    const { store, id } = await recordingMeetingWithTranscript()
    corruptReadback = true

    await expect(
      store.updateTranscriptSegment(id, { expectedRevision: 1, segmentId: 's0', patch: { startMs: 100 } }),
    ).rejects.toThrow('meeting-write-readback-failed')
  })
})