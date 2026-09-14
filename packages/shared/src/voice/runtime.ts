/**
 * Voice v2 runtime: fixture vs live transport, and local ASR adapter selection.
 *
 * HTTP stays on fixtures unless CRAFT_VOICE_GATEWAY_FIXTURE=0 so CI and bun
 * tests remain offline. Evidence collection can still leave fixture-only when
 * credentials exist; live api.rox.one is never claimed from reachability guesswork.
 */

import { catalogTemplate } from './models/catalog.ts'
import type { LocalModelFamily, ModelManifest } from './models/manifest-schema.ts'
import { GigaamE2eRnntAdapter } from './local/gigaam-adapter.ts'
import { NemotronStreamingAdapter } from './local/nemotron-adapter.ts'
import { WhisperLargeV3TurboAdapter } from './local/whisper-adapter.ts'
import type { LocalAsrAdapter } from './local/adapter.ts'
import type { SttEngine, TranscribeAdapter, VoicePrefs } from './types.ts'
import { VOICE_GATEWAY_BASE_URL } from './contracts.ts'

export const VOICE_CREDENTIAL_KEYS = [
  'CRAFT_VOICE_ACCESS_TOKEN',
  'CRAFT_VOICE_GATEWAY_TOKEN',
  'ROX_API_KEY',
] as const

export type VoiceGatewayMode = 'fixture' | 'live'
export type VoiceEnv = Record<string, string | undefined>

export function hasVoiceCredentials(env: VoiceEnv = process.env): boolean {
  return VOICE_CREDENTIAL_KEYS.some((key) => Boolean(env[key]?.trim()))
}

export function isCiEnvironment(env: VoiceEnv = process.env): boolean {
  return env.CI === 'true' || env.CI === '1'
}

export function localWeightsFixtureEnabled(env: VoiceEnv = process.env): boolean {
  return env.CRAFT_VOICE_LOCAL_FIXTURE === '1'
}

export class VoiceGatewayUnavailableError extends Error {
  readonly code = 'VOICE_GATEWAY_UNAVAILABLE' as const
  constructor(message = 'Voice gateway is not live; fixture transcripts are not production results') {
    super(message)
    this.name = 'VoiceGatewayUnavailableError'
  }
}

/** Transport: live only when explicitly opted in. CI and default stay fixtures. */
export function resolveVoiceGatewayMode(env: VoiceEnv = process.env): VoiceGatewayMode {
  if (env.CRAFT_VOICE_GATEWAY_FIXTURE === '0') return 'live'
  return 'fixture'
}

/**
 * Evidence fixture-only short-circuit. CI and explicit fixture flags keep the
 * fixture path. Credentials or CRAFT_VOICE_GATEWAY_FIXTURE=0 leave it.
 */
export function isFixtureOnlyEvidence(env: VoiceEnv = process.env): boolean {
  if (env.CRAFT_VOICE_GATEWAY_FIXTURE === '1') return true
  if (localWeightsFixtureEnabled(env)) return true
  if (isCiEnvironment(env)) return true
  if (env.CRAFT_VOICE_GATEWAY_FIXTURE === '0') return false
  if (hasVoiceCredentials(env)) return false
  return true
}

export function voiceGatewayBaseUrl(env: VoiceEnv = process.env): string {
  const configured = env.CRAFT_VOICE_GATEWAY_URL?.trim()
  return configured && configured.length > 0 ? configured.replace(/\/$/, '') : VOICE_GATEWAY_BASE_URL
}

export function resolveLocalAsrFamily(asrModelId: string): LocalModelFamily {
  const id = asrModelId.toLowerCase()
  if (id.includes('nemotron')) return 'nemotron-3.5-asr-streaming-0.6b'
  if (id.includes('gigaam')) return 'gigaam-v3-e2e-rnnt'
  return 'whisper-large-v3-turbo'
}

export function createLocalAsrAdapter(
  family: LocalModelFamily,
  options: { fixtures?: boolean } = {},
): LocalAsrAdapter {
  switch (family) {
    case 'whisper-large-v3-turbo':
      return new WhisperLargeV3TurboAdapter(options)
    case 'nemotron-3.5-asr-streaming-0.6b':
      return new NemotronStreamingAdapter(options)
    case 'gigaam-v3-e2e-rnnt':
      return new GigaamE2eRnntAdapter(options)
    default: {
      const exhaustive: never = family
      throw new Error(`Unhandled local ASR family: ${exhaustive}`)
    }
  }
}

export function hostPlatform(): ModelManifest['platform'] {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
}

export function hostArch(): ModelManifest['arch'] {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

export function localAdapterManifest(
  family: LocalModelFamily,
  options: { fixtures?: boolean; platform?: ModelManifest['platform']; arch?: ModelManifest['arch'] } = {},
): ModelManifest {
  return {
    ...catalogTemplate(family, options.platform ?? hostPlatform(), options.arch ?? hostArch()),
    files: [],
    signature: options.fixtures ? 'fixture' : 'unsigned',
  }
}

export function wrapLocalAsrAdapter(
  adapter: LocalAsrAdapter,
  engine: SttEngine = 'local-whisper',
): TranscribeAdapter {
  return {
    engine,
    async transcribe(input) {
      const result = await adapter.transcribe({ audio: input.audio, language: input.language })
      return {
        text: result.text,
        engine,
        uploaded: false,
        noSpeech: result.noSpeech,
        requestId: result.requestId,
      }
    },
  }
}

export function createConfiguredLocalTranscribeAdapter(
  prefs: Pick<VoicePrefs, 'asrModelId'>,
  env: VoiceEnv = process.env,
): TranscribeAdapter {
  const fixtures = localWeightsFixtureEnabled(env)
  const family = resolveLocalAsrFamily(prefs.asrModelId)
  const adapter = createLocalAsrAdapter(family, { fixtures })
  const inner = wrapLocalAsrAdapter(adapter)
  const manifest = localAdapterManifest(family, { fixtures })
  return {
    engine: inner.engine,
    async transcribe(input) {
      await adapter.load(manifest)
      return inner.transcribe(input)
    },
  }
}

/** Production local ASR. Never loads fixture weights or returns fixture transcripts. */
export function createProductionLocalTranscribeAdapter(
  prefs: Pick<VoicePrefs, 'asrModelId'>,
): TranscribeAdapter {
  const family = resolveLocalAsrFamily(prefs.asrModelId)
  const adapter = createLocalAsrAdapter(family, { fixtures: false })
  const inner = wrapLocalAsrAdapter(adapter)
  const manifest = localAdapterManifest(family, {
    fixtures: false,
    platform: hostPlatform(),
    arch: hostArch(),
  })
  return {
    engine: inner.engine,
    async transcribe(input) {
      await adapter.load(manifest)
      return inner.transcribe(input)
    },
  }
}

/** Production HTTP. Never returns fixture ASR JSON. */
export function createProductionVoiceHttp(env: VoiceEnv = process.env): {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
} {
  if (resolveVoiceGatewayMode(env) !== 'live') {
    return {
      async fetch() {
        throw new VoiceGatewayUnavailableError()
      },
    }
  }
  return { fetch }
}
