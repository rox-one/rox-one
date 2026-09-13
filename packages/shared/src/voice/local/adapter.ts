import type { NormalizedTranscript } from '../adapters/audio-result.ts'
import { blockedReason } from '../models/compatibility.ts'
import type { ModelManifest } from '../models/manifest-schema.ts'
export interface LocalAsrInput { audio: Uint8Array; language?: string; signal?: AbortSignal }
export interface LocalAsrAdapter {
  family: string
  load(manifest: ModelManifest): Promise<void>
  transcribe(input: LocalAsrInput): Promise<NormalizedTranscript>
  unload(): Promise<void>
}
export class LocalModelError extends Error {
  readonly code: 'not-ready' | 'unsupported' | 'wrong-variant' | 'offline-network' | 'cancelled' | 'language'
  constructor(code: LocalModelError['code'], message: string) { super(message); this.name = 'LocalModelError'; this.code = code }
}
export function assertInstallable(manifest: ModelManifest, platform: string, arch: string): void {
  const blocked = blockedReason(manifest, platform, arch)
  if (blocked) throw new LocalModelError('unsupported', blocked)
}
export function fixtureTranscript(modelId: string, language: string | undefined, requestId: string): NormalizedTranscript {
  const ru = language === 'ru' || !language
  const text = ru ? 'проверка диктовки' : 'dictation check'
  return {
    text, detectedLanguage: language === 'en' ? 'en' : 'ru',
    segments: [{ startMs: 0, endMs: 1200, text }], requestedModelId: modelId, resolvedModelId: modelId,
    requestId, durationMs: 1200, noSpeech: false,
  }
}
