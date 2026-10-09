import { describe, expect, it } from 'bun:test'
import {
  VoiceProviderError,
  createVoiceProviderRegistry,
  listRealtimeVoiceProviders,
  listSpeechProviders,
  resolveConfiguredRealtimeVoiceProvider,
  resolveConfiguredSpeechProvider,
  type RealtimeVoiceProvider,
  type SpeechProvider,
  type VoiceProviderCapabilities,
} from '../provider-registry.ts'

const capabilities: VoiceProviderCapabilities = {
  streaming: true, bargeIn: true, toolCalls: true, browserSession: true, languages: ['en'],
}

function realtimeProvider(id: string, configured: boolean): RealtimeVoiceProvider {
  return {
    id,
    displayName: id,
    capabilities,
    isConfigured: () => configured,
    createBridge: () => { throw new Error('not used') },
  }
}

function speechProvider(id: string, configured: boolean): SpeechProvider {
  return {
    id,
    displayName: id,
    capabilities: { ...capabilities, browserSession: false },
    isConfigured: () => configured,
    synthesize: () => { throw new Error('not used') },
  }
}

describe('voice provider registry', () => {
  it('throws a typed unconfigured error when no realtime provider is configured', () => {
    const source = { realtime: [realtimeProvider('openai', false)] }
    let error: unknown
    try {
      resolveConfiguredRealtimeVoiceProvider(source)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(VoiceProviderError)
    expect((error as VoiceProviderError).code).toBe('unconfigured')
    expect((error as Error).message).toMatch(/no realtime voice provider is configured/i)
  })

  it('throws unconfigured for an explicitly preferred but unconfigured provider', () => {
    const source = { realtime: [realtimeProvider('openai', false), realtimeProvider('other', true)] }
    expect(() => resolveConfiguredRealtimeVoiceProvider(source, 'openai')).toThrow(VoiceProviderError)
    expect(resolveConfiguredRealtimeVoiceProvider(source, 'other').id).toBe('other')
  })

  it('throws unknown-provider for an id that does not exist', () => {
    let error: unknown
    try {
      resolveConfiguredRealtimeVoiceProvider({ realtime: [] }, 'missing')
    } catch (caught) {
      error = caught
    }
    expect((error as VoiceProviderError).code).toBe('unknown-provider')
  })

  it('prefers the first configured provider when no preference is given', () => {
    const source = { realtime: [realtimeProvider('a', false), realtimeProvider('b', true)] }
    expect(resolveConfiguredRealtimeVoiceProvider(source).id).toBe('b')
  })

  it('resolves speech providers with the same configured-only rule', () => {
    const source = { speech: [speechProvider('edge', true), speechProvider('system', false)] }
    expect(resolveConfiguredSpeechProvider(source).id).toBe('edge')
    expect(() => resolveConfiguredSpeechProvider({ speech: [speechProvider('system', false)] })).toThrow(VoiceProviderError)
  })

  it('describes configured flags and surfaces through the registry facade', () => {
    const source = { realtime: [realtimeProvider('openai', true)], speech: [speechProvider('edge', true)] }
    expect(listRealtimeVoiceProviders(source)).toEqual([{ id: 'openai', kind: 'realtime', displayName: 'openai', configured: true, capabilities }])
    expect(listSpeechProviders(source)[0]!.kind).toBe('speech')
    const registry = createVoiceProviderRegistry(source)
    expect(registry.list('realtime').map((entry) => entry.id)).toEqual(['openai'])
    expect(registry.resolveRealtime().id).toBe('openai')
    expect(registry.resolveSpeech().id).toBe('edge')
  })
})