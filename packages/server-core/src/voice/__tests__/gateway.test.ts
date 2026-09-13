import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ROX_VOICE_PUBLIC_MODEL_ID,
  ROX_VOICE_UPSTREAM_ASR_MODEL,
  VoicePrivacyError,
} from '@craft-agent/shared/voice'
import {
  resolveVoiceAccessToken,
  transcribeViaRoxGateway,
  type VoiceFetch,
} from '../gateway'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ROX voice gateway', () => {
  it('uses ROX_VOICE_TOKEN before bootstrap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-gw-'))
    let called = false
    const fetch: VoiceFetch = async () => {
      called = true
      return jsonResponse(500, {})
    }
    const resolved = await resolveVoiceAccessToken({
      fetch,
      configDir: dir,
      env: { ROX_VOICE_TOKEN: 'scoped-token' },
    })
    expect(resolved.token).toBe('scoped-token')
    expect(resolved.source).toBe('env')
    expect(called).toBe(false)
  })

  it('retries rocks-t1 404 onto whisper-large-v3-turbo', async () => {
    const models: string[] = []
    const fetch: VoiceFetch = async (_url, init) => {
      const body = init?.body as FormData
      const model = String(body.get('model'))
      models.push(model)
      if (model === ROX_VOICE_PUBLIC_MODEL_ID) return jsonResponse(404, { error: 'missing alias' })
      return jsonResponse(200, {
        text: ' распознано ',
        language: 'ru',
        duration: 1.2,
        model: ROX_VOICE_UPSTREAM_ASR_MODEL,
        segments: [{ id: 0, start: 0, end: 1.2, text: 'распознано' }],
        words: [{ word: 'распознано', start: 0, end: 1.2 }],
      })
    }
    const result = await transcribeViaRoxGateway(
      { fetch, env: { ROX_VOICE_TOKEN: 't' } },
      'scoped-token',
      { audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' },
    )
    expect(models).toEqual([ROX_VOICE_PUBLIC_MODEL_ID, ROX_VOICE_UPSTREAM_ASR_MODEL])
    expect(result.text).toBe('распознано')
    expect(result.segments?.[0]?.text).toBe('распознано')
    expect(result.words?.[0]?.word).toBe('распознано')
    expect(result.uploaded).toBe(true)
  })

  it('maps 401 to unauthorized without leaking a master key', async () => {
    const fetch: VoiceFetch = async () => jsonResponse(401, { error: 'nope' })
    await expect(transcribeViaRoxGateway(
      { fetch, env: { ROX_VOICE_TOKEN: 't' } },
      'scoped-token',
      { audio: new Uint8Array([1]), mimeType: 'audio/webm' },
    )).rejects.toMatchObject({ code: 'cloud-stt-unauthorized' } satisfies Partial<VoicePrivacyError>)
  })
})
