import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readVoiceAudioChunk } from './voice-audio-read'
import type { VoiceRecording } from '@rox/shared/voice/history'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-owned-voice-audio-'))
  const id = randomUUID(), directory = join(root, 'voice', 'recordings', id)
  mkdirSync(directory, { recursive: true })
  const bytes = Buffer.alloc(300_000, 97), file = join(directory, 'original.bin')
  writeFileSync(file, bytes)
  const recording: VoiceRecording = { id, createdAt: 1, durationMs: 0, audioPath: '/PRIVATE-UNTRUSTED-PATH', hash: createHash('sha256').update(bytes).digest('hex'), format: 'webm', state: 'finalized', favorite: false }
  return { root, file, directory, bytes, recording, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
test('actual audio frames reassemble completely and never expose or consume stored paths', () => {
  const f = fixture()
  try {
    const first = readVoiceAudioChunk(f.root, f.recording, { offset: 0, path: '/etc/passwd' })
    const last = readVoiceAudioChunk(f.root, f.recording, { offset: 192 * 1024, token: first.token })
    expect(Buffer.concat([Buffer.from(first.audioBase64, 'base64'), Buffer.from(last.audioBase64, 'base64')])).toEqual(f.bytes)
    expect(first.totalBytes).toBe(300_000); expect(first.mimeType).toBe('audio/webm')
    expect(JSON.stringify(first)).not.toContain(f.root); expect(JSON.stringify(first)).not.toContain('PRIVATE')
    expect(() => readVoiceAudioChunk(f.root, f.recording, { offset: 192 * 1024, token: 'foreign' })).toThrow()
    expect(() => readVoiceAudioChunk(f.root, f.recording, { offset: 1 })).toThrow()
  } finally { f.dispose() }
})
test('replacement original invalidates a previously issued stream token', () => {
  const f = fixture()
  try {
    const first = readVoiceAudioChunk(f.root, f.recording, { offset: 0 })
    renameSync(f.file, f.file + '.old'); writeFileSync(f.file, f.bytes)
    expect(() => readVoiceAudioChunk(f.root, f.recording, { offset: 192 * 1024, token: first.token })).toThrow()
  } finally { f.dispose() }
})
for (const target of ['leaf', 'parent'] as const) test(`linked ${target} is refused without returning outside audio`, () => {
  const f = fixture(), outside = mkdtempSync(join(tmpdir(), 'rox-foreign-voice-audio-'))
  try {
    writeFileSync(join(outside, 'original.bin'), 'FOREIGN-SENSITIVE-FIXTURE')
    if (target === 'leaf') { rmSync(f.file); symlinkSync(join(outside, 'original.bin'), f.file) }
    else { rmSync(f.directory, { recursive: true }); symlinkSync(outside, f.directory) }
    expect(() => readVoiceAudioChunk(f.root, f.recording, { offset: 0 })).toThrow()
  } finally { f.dispose(); rmSync(outside, { recursive: true, force: true }) }
})
