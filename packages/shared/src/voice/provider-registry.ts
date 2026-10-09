/**
 * Voice provider registry — realtime voice and speech capabilities resolved from
 * the workspace server's existing service-key surface.
 *
 * A provider is only returned by a resolver when it is actually configured; the
 * unconfigured case is a typed `VoiceProviderError('unconfigured')`, never a fake
 * provider. Credentials are read in the registry's owning process (the workspace
 * server / Electron main) and never travel to the renderer.
 *
 * Provenance: OpenClaw `src/talk/provider-registry.ts`, `src/talk/provider-resolver.ts`,
 * `src/tts/provider-registry.ts` (clean-room re-expression; ledger d1.2).
 */

import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceBridgeConfig,
} from './realtime-bridge-types.ts'

export type VoiceProviderKind = 'realtime' | 'speech' | 'transcription'

export interface VoiceProviderCapabilities {
  streaming: boolean
  bargeIn: boolean
  toolCalls: boolean
  /** `browser` providers mint an ephemeral client secret; `server` keeps audio server-side. */
  browserSession: boolean
  languages: string[]
}

export interface VoiceProviderInfo {
  id: string
  kind: VoiceProviderKind
  displayName: string
  configured: boolean
  capabilities: VoiceProviderCapabilities
}

export type VoiceProviderErrorCode = 'unconfigured' | 'unknown-provider' | 'unsupported'

export class VoiceProviderError extends Error {
  readonly code: VoiceProviderErrorCode

  constructor(code: VoiceProviderErrorCode, message: string) {
    super(message)
    this.name = 'VoiceProviderError'
    this.code = code
  }
}

export interface RealtimeBrowserSessionRequest {
  instructions?: string
  voice?: string
  model?: string
  workspaceId?: string
}

export interface RealtimeBrowserSession {
  /** Short-lived provider credential for the browser; the durable key stays in main. */
  clientSecret: string
  expiresAt: number
  offerUrl?: string
  model?: string
}

export interface RealtimeVoiceProvider {
  id: string
  displayName: string
  capabilities: VoiceProviderCapabilities
  isConfigured(): boolean
  createBridge(callbacks: RealtimeVoiceBridgeCallbacks, config: RealtimeVoiceBridgeConfig): Promise<RealtimeVoiceBridge>
  createBrowserSession?(request: RealtimeBrowserSessionRequest): Promise<RealtimeBrowserSession>
}

export interface SpeechSynthesisInput {
  text: string
  voice?: string
  language?: string
  signal?: AbortSignal
}

export interface SpeechSynthesisResult {
  audioBuffer: Uint8Array
  outputFormat: string
  fileExtension: string
  voiceCompatible: boolean
}

export interface SpeechSynthesisStreamResult {
  audioStream: ReadableStream<Uint8Array>
  release(): void
}

export interface SpeechProvider {
  id: string
  displayName: string
  capabilities: VoiceProviderCapabilities
  isConfigured(): boolean
  synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>
  streamSynthesize?(input: SpeechSynthesisInput): Promise<SpeechSynthesisStreamResult>
  listVoices?(): Promise<string[]>
}

export interface VoiceProviderSource {
  realtime?: readonly RealtimeVoiceProvider[]
  speech?: readonly SpeechProvider[]
}

export function listRealtimeVoiceProviders(source: VoiceProviderSource): VoiceProviderInfo[] {
  return (source.realtime ?? []).map((provider) => describeRealtimeProvider(provider))
}

export function listSpeechProviders(source: VoiceProviderSource): VoiceProviderInfo[] {
  return (source.speech ?? []).map((provider) => ({
    id: provider.id,
    kind: 'speech' as const,
    displayName: provider.displayName,
    configured: provider.isConfigured(),
    capabilities: provider.capabilities,
  }))
}

function describeRealtimeProvider(provider: RealtimeVoiceProvider): VoiceProviderInfo {
  return {
    id: provider.id,
    kind: 'realtime',
    displayName: provider.displayName,
    configured: provider.isConfigured(),
    capabilities: provider.capabilities,
  }
}

export function getRealtimeVoiceProvider(source: VoiceProviderSource, id: string): RealtimeVoiceProvider {
  const provider = (source.realtime ?? []).find((candidate) => candidate.id === id)
  if (!provider) throw new VoiceProviderError('unknown-provider', `Unknown realtime voice provider: ${id}`)
  return provider
}

export function getSpeechProvider(source: VoiceProviderSource, id: string): SpeechProvider {
  const provider = (source.speech ?? []).find((candidate) => candidate.id === id)
  if (!provider) throw new VoiceProviderError('unknown-provider', `Unknown speech provider: ${id}`)
  return provider
}

/**
 * Resolve a realtime provider. An explicit `preferred` id must exist and be
 * configured; without a preference the first configured provider wins. When
 * nothing is configured the failure is a typed `unconfigured` error.
 */
export function resolveConfiguredRealtimeVoiceProvider(
  source: VoiceProviderSource,
  preferred?: string,
): RealtimeVoiceProvider {
  const providers = source.realtime ?? []
  if (preferred) {
    const provider = getRealtimeVoiceProvider(source, preferred)
    if (!provider.isConfigured()) {
      throw new VoiceProviderError('unconfigured', `Realtime voice provider ${preferred} is not configured`)
    }
    return provider
  }
  const configured = providers.find((provider) => provider.isConfigured())
  if (!configured) {
    throw new VoiceProviderError('unconfigured', 'No realtime voice provider is configured on this server')
  }
  return configured
}

export function resolveConfiguredSpeechProvider(source: VoiceProviderSource, preferred?: string): SpeechProvider {
  const providers = source.speech ?? []
  if (preferred) {
    const provider = getSpeechProvider(source, preferred)
    if (!provider.isConfigured()) {
      throw new VoiceProviderError('unconfigured', `Speech provider ${preferred} is not configured`)
    }
    return provider
  }
  const configured = providers.find((provider) => provider.isConfigured())
  if (!configured) throw new VoiceProviderError('unconfigured', 'No speech provider is configured on this server')
  return configured
}

export interface VoiceProviderRegistry {
  list(kind?: VoiceProviderKind): VoiceProviderInfo[]
  resolveRealtime(preferred?: string): RealtimeVoiceProvider
  resolveSpeech(preferred?: string): SpeechProvider
}

export function createVoiceProviderRegistry(source: VoiceProviderSource): VoiceProviderRegistry {
  return {
    list(kind) {
      const entries = [...listRealtimeVoiceProviders(source), ...listSpeechProviders(source)]
      return kind ? entries.filter((entry) => entry.kind === kind) : entries
    },
    resolveRealtime: (preferred) => resolveConfiguredRealtimeVoiceProvider(source, preferred),
    resolveSpeech: (preferred) => resolveConfiguredSpeechProvider(source, preferred),
  }
}