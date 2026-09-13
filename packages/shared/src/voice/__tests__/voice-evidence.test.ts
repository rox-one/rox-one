import { describe, expect, it } from 'bun:test'
import {
  classifyEvidence,
  collectEvidenceInput,
  createLocalAsrAdapter,
  createProductionLocalTranscribeAdapter,
  createProductionVoiceHttp,
  hasVoiceCredentials,
  isFixtureOnlyEvidence,
  localAdapterManifest,
  probeVoiceGateway,
  reportEvidence,
  resolveLocalAsrFamily,
  resolveVoiceGatewayMode,
  VoiceGatewayUnavailableError,
} from '../index.ts'

const ciEnv = { CI: '1' }
const credEnv = { ROX_API_KEY: 'rox_test_key' }
const liveEnv = { CRAFT_VOICE_GATEWAY_FIXTURE: '0', ROX_API_KEY: 'rox_test_key' }

describe('voice evidence runtime', () => {
  it('keeps CI and default installs on the fixture transport', () => {
    expect(resolveVoiceGatewayMode(ciEnv)).toBe('fixture')
    expect(resolveVoiceGatewayMode({})).toBe('fixture')
    expect(resolveVoiceGatewayMode(credEnv)).toBe('fixture')
    expect(resolveVoiceGatewayMode(liveEnv)).toBe('live')
    expect(isFixtureOnlyEvidence(ciEnv)).toBe(true)
    expect(isFixtureOnlyEvidence({ CRAFT_VOICE_GATEWAY_FIXTURE: '1', ROX_API_KEY: 'rox_test_key' })).toBe(true)
    expect(isFixtureOnlyEvidence({})).toBe(true)
  })

  it('leaves fixture-only when credentials exist outside CI', () => {
    expect(hasVoiceCredentials(credEnv)).toBe(true)
    expect(isFixtureOnlyEvidence(credEnv)).toBe(false)
    const input = collectEvidenceInput(credEnv)
    expect(input.fixtureOnly).toBe(false)
    expect(classifyEvidence(input).class).toBe('scaffold')
    expect(classifyEvidence(input).reasons).not.toContain('Fixtures are not production ASR evidence')
  })

  it('can reach cloud-beta only after a successful live probe', async () => {
    const report = await reportEvidence({
      env: liveEnv,
      overlayWithoutFocusSteal: true,
      historyDurable: true,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })
    expect(report.fixtureOnly).toBe(false)
    expect(report.gatewayMode).toBe('live')
    expect(report.liveClaimed).toBe(true)
    expect(report.class).toBe('cloud-beta')
  })

  it('does not claim live api.rox.one when the gateway is unreachable', async () => {
    const report = await reportEvidence({
      env: liveEnv,
      overlayWithoutFocusSteal: true,
      historyDurable: true,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    })
    expect(report.liveClaimed).toBe(false)
    expect(report.gatewayReachable).toBe(false)
    expect(report.class).not.toBe('cloud-beta')
    expect(report.reasons.some((reason) => reason.includes('unreachable'))).toBe(true)
  })

  it('skips probing on the CI fixture path', async () => {
    let called = 0
    const report = await reportEvidence({
      env: { CI: '1', ROX_API_KEY: 'rox_test_key' },
      fetchImpl: async () => {
        called += 1
        return new Response('{}', { status: 200 })
      },
    })
    expect(called).toBe(0)
    expect(report.fixtureOnly).toBe(true)
    expect(report.class).toBe('scaffold')
    expect(report.liveClaimed).toBe(false)
  })
})

describe('local ASR adapter selection', () => {
  it('selects Whisper, Nemotron, or GigaAM from asrModelId', () => {
    expect(resolveLocalAsrFamily('rocks-t1')).toBe('whisper-large-v3-turbo')
    expect(resolveLocalAsrFamily('whisper-large-v3-turbo')).toBe('whisper-large-v3-turbo')
    expect(resolveLocalAsrFamily('nemotron-3.5-asr-streaming-0.6b')).toBe('nemotron-3.5-asr-streaming-0.6b')
    expect(resolveLocalAsrFamily('gigaam-v3-e2e-rnnt')).toBe('gigaam-v3-e2e-rnnt')
  })

  it('production factories never return fixture transcripts', async () => {
    const http = createProductionVoiceHttp({})
    await expect(http.fetch('https://api.rox.one/v1/audio/transcriptions')).rejects.toThrow(VoiceGatewayUnavailableError)
    const live = createProductionVoiceHttp({ CRAFT_VOICE_GATEWAY_FIXTURE: '0' })
    expect(live.fetch).toBe(fetch)
    const adapter = createProductionLocalTranscribeAdapter({ asrModelId: 'whisper-large-v3-turbo' })
    await expect(adapter.transcribe({ audio: new Uint8Array([1]), mimeType: 'audio/wav' })).rejects.toThrow()
  })

  it('runs fixture inference for the configured family and refuses missing weights', async () => {
    const audio = new Uint8Array(16)
    for (const family of ['whisper-large-v3-turbo', 'nemotron-3.5-asr-streaming-0.6b', 'gigaam-v3-e2e-rnnt'] as const) {
      const ready = createLocalAsrAdapter(family, { fixtures: true })
      await ready.load(localAdapterManifest(family, { fixtures: true, platform: 'linux', arch: 'x64' }))
      const transcript = await ready.transcribe({ audio, language: family === 'gigaam-v3-e2e-rnnt' ? 'ru' : 'en' })
      expect(transcript.requestedModelId).toContain(family === 'whisper-large-v3-turbo' ? 'whisper' : family.split('-')[0]!)
      const blocked = createLocalAsrAdapter(family, { fixtures: false })
      await expect(blocked.load(localAdapterManifest(family, { fixtures: false, platform: 'linux', arch: 'x64' })))
        .rejects.toMatchObject({ code: 'not-ready' })
    }
  })
})

describe('gateway probe', () => {
  it('treats http failures as unreachable without throwing', async () => {
    const probe = await probeVoiceGateway({
      fetchImpl: async () => new Response('no', { status: 503 }),
      timeoutMs: 50,
    })
    expect(probe.reachable).toBe(false)
    expect(probe.status).toBe(503)
  })
})
