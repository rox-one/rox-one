import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultVoicePrefs, loadVoicePrefs, saveVoicePrefs } from '@craft-agent/shared/voice'
import { DeviceVoiceHost } from '../host'

describe('DeviceVoiceHost', () => {
  it('keeps audio after stop and survives a second host instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), audioRetention: 'cloud-policy' }, dir)
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'hello from disk',
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk-one'))
    await host.stop(rec.id)
    const result = await host.transcribeRecording(rec.id, {} as never)
    expect(result.text).toBe('hello from disk')

    const recovered = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'should not run',
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const listed = await recovered.list()
    expect(listed[0]?.status).toBe('complete')
    expect(listed[0]?.result?.text).toBe('hello from disk')
  })

  it('marks in-flight recordings interrupted on reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    await host.start('audio/webm')
    const next = new DeviceVoiceHost({ configDir: dir })
    const listed = await next.list()
    expect(listed[0]?.status).toBe('interrupted')
  })

  it('cancel keeps the recording with canceled status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.cancel(rec.id)
    const listed = await host.list()
    expect(listed[0]?.status).toBe('canceled')
  })

  it('delete removes journal and audio without dropping other recordings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'keep', engine: 'cloud-rox', uploaded: true }),
    })
    const first = await host.start('audio/webm')
    await host.appendChunk(first.id, Buffer.from('one'))
    await host.stop(first.id)
    const second = await host.start('audio/webm')
    await host.appendChunk(second.id, Buffer.from('two'))
    await host.cancel(second.id)
    await host.setFavorite(first.id, true)
    await host.delete(second.id)
    const listed = await host.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(first.id)
    expect(listed[0]?.favorite).toBe(true)
  })

  it('returns audio bytes without listing the file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk-one'))
    await host.stop(rec.id, { durationMs: 1500 })
    const listed = await host.list()
    expect(listed[0]?.durationMs).toBe(1500)
    expect(JSON.stringify(listed)).not.toContain('audioPath')
    const audio = await host.getAudio(rec.id)
    expect(audio.mimeType).toBe('audio/webm')
    expect(Buffer.from(audio.audioBase64, 'base64').toString()).toBe('chunk-one')
    expect(JSON.stringify(audio)).not.toContain('audioPath')
  })

  it('retranscribe appends a new ASR revision and keeps the original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const requestIds: string[] = []
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async (input) => {
        requestIds.push(input.requestId ?? '')
        return {
          text: `pass-${requestIds.length}`,
          engine: 'cloud-rox',
          uploaded: true,
          segments: [{ id: 0, start: 0, end: 1, text: `pass-${requestIds.length}` }],
        }
      },
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    const prefs = getDefaultVoicePrefs()
    await host.transcribeRecording(rec.id, prefs)
    await host.transcribeRecording(rec.id, prefs)
    const listed = await host.list()
    expect(listed[0]?.revisions).toHaveLength(2)
    expect(listed[0]?.revisions?.[0]?.text).toBe('pass-1')
    expect(listed[0]?.revisions?.[1]?.text).toBe('pass-2')
    expect(listed[0]?.result?.text).toBe('pass-2')
    expect(JSON.stringify(listed)).not.toContain('audioPath')
    expect(requestIds[0]).toBe(`${rec.id}:0`)
    expect(requestIds[1]).toBe(`${rec.id}:1`)

    const selected = await host.selectRevision(rec.id, listed[0]!.revisions![0]!.id)
    expect(selected.result?.text).toBe('pass-1')
    expect(selected.selectedRevisionId).toBe(listed[0]!.revisions![0]!.id)
  })

  it('exports txt and json next to audio and refuses SRT without timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'hello export',
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, getDefaultVoicePrefs())

    const txt = await host.exportRecording(rec.id, 'txt')
    expect(readFileSync(txt.path, 'utf8')).toBe('hello export')
    const json = await host.exportRecording(rec.id, 'json')
    const exported = JSON.parse(readFileSync(json.path, 'utf8')) as { result?: { text?: string } }
    expect(exported.result?.text).toBe('hello export')
    expect(JSON.stringify(exported)).not.toContain('audioPath')
    await expect(host.exportRecording(rec.id, 'srt')).rejects.toThrow('SRT export needs timestamped ASR output')
  })

  it('hydrates a result-only journal into one revision and then appends retranscription', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), audioRetention: 'cloud-policy' }, dir)
    const recordingsDir = join(dir, 'voice', 'recordings')
    mkdirSync(recordingsDir, { recursive: true })
    const audioPath = join(recordingsDir, 'rec_old.webm')
    writeFileSync(audioPath, 'legacy-bytes')
    writeFileSync(join(dir, 'voice', 'journal.json'), `${JSON.stringify({
      recordings: [{
        id: 'rec_old',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:10.000Z',
        status: 'complete',
        mimeType: 'audio/webm',
        audioPath,
        result: { text: 'original', engine: 'cloud-rox', uploaded: true },
      }],
    }, null, 2)}\n`)

    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'second pass',
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const listed = await host.list()
    expect(listed[0]?.revisions).toHaveLength(1)
    expect(listed[0]?.revisions?.[0]?.text).toBe('original')
    expect(listed[0]?.selectedRevisionId).toBe(listed[0]?.revisions?.[0]?.id)
    expect(JSON.stringify(listed)).not.toContain('audioPath')

    await host.transcribeRecording('rec_old', getDefaultVoicePrefs())
    const after = await host.list()
    expect(after[0]?.revisions).toHaveLength(2)
    expect(after[0]?.revisions?.[0]?.text).toBe('original')
    expect(after[0]?.revisions?.[1]?.text).toBe('second pass')
  })

  it('writes SRT from timestamped ASR output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'hello world',
        engine: 'cloud-rox',
        uploaded: true,
        segments: [
          { id: 0, start: 0, end: 1, text: 'hello' },
          { id: 1, start: 1, end: 2, text: 'world' },
        ],
      }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, getDefaultVoicePrefs())
    const srt = await host.exportRecording(rec.id, 'srt')
    expect(readFileSync(srt.path, 'utf8')).toContain('00:00:00,000 --> 00:00:01,000')
    expect(readFileSync(srt.path, 'utf8')).toContain('hello')
  })

  it('discards audio bytes after transcription when retention is none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), audioRetention: 'none' }, dir)
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'gone', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, loadVoicePrefs(dir))
    const listed = await host.list()
    expect(listed[0]?.audioAvailable).toBe(false)
    expect(listed[0]?.result?.text).toBe('gone')
    await expect(host.getAudio(rec.id)).rejects.toThrow('Audio was discarded by retention policy')
  })

  it('session retention keeps audio until a new host loads, then favorites survive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), audioRetention: 'session' }, dir)
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'kept', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, loadVoicePrefs(dir))
    await host.setFavorite(rec.id, true)
    expect((await host.list())[0]?.audioAvailable).toBe(true)

    const recovered = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    expect((await recovered.list())[0]?.audioAvailable).toBe(true)
    expect(Buffer.from((await recovered.getAudio(rec.id)).audioBase64, 'base64').toString()).toBe('chunk')
  })

  it('session retention drops non-favorite audio on host reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), audioRetention: 'session' }, dir)
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'temp', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, loadVoicePrefs(dir))
    const recovered = new DeviceVoiceHost({ configDir: dir })
    expect((await recovered.list())[0]?.audioAvailable).toBe(false)
    await expect(recovered.getAudio(rec.id)).rejects.toThrow('Audio was discarded by retention policy')
  })

  it('interrupts the previous capture when a second start arrives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    const first = await host.start('audio/webm')
    await host.appendChunk(first.id, Buffer.from('one'))
    const second = await host.start('audio/webm')
    const listed = await host.list()
    const prev = listed.find((item) => item.id === first.id)
    expect(prev?.status).toBe('interrupted')
    expect(second.status).toBe('recording')
    expect((await host.status()).activeId).toBe(second.id)
  })

  it('shutdown cancels the active capture and aborts inflight work', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({ text: 'n', engine: 'cloud-rox', uploaded: true }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.shutdown()
    const listed = await host.list()
    expect(listed.find((item) => item.id === rec.id)?.status).toBe('canceled')
    expect((await host.status()).activeId).toBeNull()
  })

  it('stores a manual transcript revision without treating it as ASR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-host-'))
    const host = new DeviceVoiceHost({
      configDir: dir,
      transcribe: async () => ({
        text: 'model output',
        engine: 'cloud-rox',
        uploaded: true,
        segments: [{ id: 0, start: 0, end: 1, text: 'model output' }],
      }),
    })
    const rec = await host.start('audio/webm')
    await host.appendChunk(rec.id, Buffer.from('chunk'))
    await host.stop(rec.id)
    await host.transcribeRecording(rec.id, getDefaultVoicePrefs())
    const edited = await host.editTranscript(rec.id, '  human fix  ')
    expect(edited.revisions).toHaveLength(2)
    expect(edited.revisions?.[1]?.kind).toBe('manual')
    expect(edited.result?.text).toBe('human fix')
    expect(edited.result?.segments).toBeUndefined()
    await expect(host.editTranscript(rec.id, '   ')).rejects.toThrow('Transcript is empty')
  })
})
