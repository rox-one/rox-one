import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readVoiceAudio, voiceHistoryDetail } from '../voice-history-session'

const bytes = Buffer.alloc(300_000, 97), hash = createHash('sha256').update(bytes).digest('hex'), token = 'f'.repeat(64)
const chunk = (offset: number) => ({ audioBase64: bytes.subarray(offset, Math.min(offset + 192 * 1024, bytes.length)).toString('base64'), offset, totalBytes: bytes.length, hash, token, mimeType: 'audio/webm' })
test('actual bounded audio consumer verifies every byte before creating playback Blob', async () => {
  const calls: unknown[] = []
  const blob = await readVoiceAudio({ async readVoiceRecordingAudio(payload) { calls.push(payload); return chunk(payload.offset) } }, 'recording', () => true)
  expect(Buffer.from(await blob!.arrayBuffer())).toEqual(bytes)
  expect(calls).toEqual([{ id: 'recording', offset: 0, token: undefined }, { id: 'recording', offset: 192 * 1024, token }])
})
test('audio consumer rejects corrupt bytes and replaced stream identity', async () => {
  await expect(readVoiceAudio({ async readVoiceRecordingAudio(payload) { return { ...chunk(payload.offset), hash: '0'.repeat(64) } } }, 'recording', () => true)).rejects.toThrow('integrity')
  await expect(readVoiceAudio({ async readVoiceRecordingAudio(payload) { return { ...chunk(payload.offset), token: payload.offset ? 'e'.repeat(64) : token } } }, 'recording', () => true)).rejects.toThrow('changed')
})
test('late owned audio reply after close cannot become a playback Blob or request another frame', async () => {
  let current = true, calls = 0
  expect(await readVoiceAudio({ async readVoiceRecordingAudio(payload) { calls++; current = false; return chunk(payload.offset) } }, 'recording', () => current)).toBeNull()
  expect(calls).toBe(1)
})
test('detail refuses foreign revisions and strips absolute paths from renderer state', () => {
  const value = { recording: { id: 'one', audioPath: '/secret' }, revisions: [{ id: 'r1', recordingId: 'one', text: 'owned', segments: [] }] }
  expect(voiceHistoryDetail(value, 'one').recording.audioPath).toBe('')
  expect(() => voiceHistoryDetail(value, 'two')).toThrow()
  expect(() => voiceHistoryDetail({ ...value, revisions: [{ ...value.revisions[0], recordingId: 'foreign' }] }, 'one')).toThrow()
})
