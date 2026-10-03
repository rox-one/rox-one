import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceHost } from '../host.ts'
import { getDefaultVoicePrefs } from '../types.ts'
import { loadHistoryIndex } from '../history-store.ts'
import type { NormalizedTranscript } from '../adapters/audio-result.ts'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const prefs = { ...getDefaultVoicePrefs(), cloudAsrConsent: true }
const result: NormalizedTranscript = { text: 'One paragraph.\n\nAnother paragraph.',
  segments: [{ startMs: 0, endMs: 500, text: 'One paragraph.', speakerId: 'speaker-1' }, { startMs: 1000, endMs: 1500, text: 'Another paragraph.', speakerId: 'speaker-2' }],
  requestedModelId: 'nova-3', resolvedModelId: 'nova-3', modelRevision: 'synthetic-latest', requestId: 'synthetic-request', durationMs: 2000, noSpeech: false }
function directory() { const dir = mkdtempSync(join(tmpdir(), 'voice-host-dg-')); directories.push(dir); return dir }
function capture(host: VoiceHost) { const job = host.start(prefs); host.grantPermission(); host.chunk(new Uint8Array([1, 2, 3])); return job }

describe('VoiceHost single transcription ownership', () => {
  it('STOP returns the same diarized transcript it stores, from exactly one provider request', async () => {
    const dir = directory(); let calls = 0
    const host = new VoiceHost(dir, { async transcribe() { calls++; return result } })
    const job = capture(host)
    const finished = await host.stop(prefs)
    expect(calls).toBe(1)
    expect(finished).toMatchObject({ job: 'ready', transcript: result })
    const index = loadHistoryIndex(dir)
    expect(index.revisions).toHaveLength(1)
    expect(index.recordings[0]?.durationMs).toBe(2000)
    expect(index.recordings[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(index.revisions[0]).toMatchObject({ recordingId: job.recordingId, text: result.text, segments: result.segments, modelRevision: 'synthetic-latest' })
  })

  it('cancel aborts active transcription and late success cannot affect a subsequent capture', async () => {
    const dir = directory(); const pending = Promise.withResolvers<NormalizedTranscript>(); let signal: AbortSignal | undefined
    const host = new VoiceHost(dir, { async transcribe(_audio, _mime, _language, nextSignal) { signal = nextSignal; return pending.promise } })
    capture(host)
    const stopping = host.stop(prefs)
    expect(host.cancel()?.job).toBe('cancelled')
    expect(signal?.aborted).toBe(true)
    const next = capture(host)
    pending.resolve(result)
    expect((await stopping).job).toBe('cancelled')
    expect(host.current()?.jobId).toBe(next.jobId)
    expect(loadHistoryIndex(dir).revisions).toHaveLength(0)
    host.cancel()
  })

  it('cancelled failure does not clear a new recording or emit a failed predecessor job', async () => {
    const pending = Promise.withResolvers<NormalizedTranscript>()
    const host = new VoiceHost(directory(), { async transcribe() { return pending.promise } })
    const events: string[] = []; host.on((event) => events.push(event.job.job))
    capture(host); const stopping = host.stop(prefs); host.cancel(); const next = capture(host)
    pending.reject(new Error('late network failure'))
    expect((await stopping).job).toBe('cancelled')
    expect(host.current()?.jobId).toBe(next.jobId)
    expect(events).not.toContain('failed')
    host.cancel()
  })
})

describe('VoiceHost archive opt-out', () => {
  it('transcribes in memory without writing audio, transcript history or recoverable chunks', async () => {
    const dir = directory(); const noArchive = { ...prefs, localArchivePolicy: 'none' as const }
    const host = new VoiceHost(dir, { async transcribe(audio) { expect([...audio]).toEqual([1,2,3]); return result } })
    host.start(noArchive); host.grantPermission(); host.chunk(new Uint8Array([1,2,3]))
    expect(existsSync(join(dir, 'voice'))).toBe(false)
    const finished = await host.stop(noArchive)
    expect(finished.transcript?.text).toBe(result.text)
    expect(existsSync(join(dir, 'voice'))).toBe(false)
    expect(loadHistoryIndex(dir).recordings).toHaveLength(0)
    expect(host.recover()).toEqual([])
  })
  it('discards capture chunks if the archive preference is revoked before STOP', async () => {
    const dir = directory(); const host = new VoiceHost(dir, { async transcribe() { return result } })
    const job = capture(host)
    expect(existsSync(join(dir, 'voice', 'recordings', job.recordingId))).toBe(true)
    expect((await host.stop({ ...prefs, localArchivePolicy: 'none' })).job).toBe('ready')
    expect(existsSync(join(dir, 'voice', 'recordings', job.recordingId))).toBe(false)
    expect(loadHistoryIndex(dir).revisions).toHaveLength(0)
  })
  it('leaves no audio on disk after provider failure or cancellation with archiving disabled', async () => {
    for (const cancel of [false,true]) {
      const dir = directory(); const noArchive = { ...prefs, localArchivePolicy: 'none' as const }
      const pending = Promise.withResolvers<NormalizedTranscript>()
      const host = new VoiceHost(dir, { async transcribe() { return pending.promise } })
      host.start(noArchive); host.grantPermission(); host.chunk(new Uint8Array([1]))
      const stopping=host.stop(noArchive);if(cancel) host.cancel();pending.reject(new Error('Synthetic provider failure'))
      expect((await stopping).job).toBe(cancel?'cancelled':'failed')
      expect(existsSync(join(dir,'voice'))).toBe(false)
    }
  })
})
