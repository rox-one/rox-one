/**
 * Buffered speech synthesis over a resolved `SpeechProvider`.
 *
 * Wraps the existing Edge (`edge-tts`) and system (`say`) adapters behind the
 * provider contract used by the realtime surface, and rejects empty/oversized
 * or silent results instead of handing the caller a fake buffer.
 *
 * Provenance: OpenClaw `src/tts/tts-synthesis.ts` (ledger d1.4).
 */

import type {
  SpeechProvider,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  VoiceProviderCapabilities,
} from '../provider-registry.ts'
import { createEdgeSpeakAdapter } from '../adapters/edge-tts.ts'
import type { SpeakAdapter, SpeakResult } from '../types.ts'

export const MAX_SPEECH_TEXT_BYTES = 20_000

export async function synthesizeSpeech(provider: SpeechProvider, input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
  const text = input.text.trim()
  if (!text) throw new Error('Speech text is empty')
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEECH_TEXT_BYTES) throw new Error('Speech text is too large')
  const result = await provider.synthesize({ ...input, text })
  if (!result.audioBuffer.byteLength) throw new Error('Speech provider returned no audio')
  return result
}

/** Map a buffered `SpeakAdapter` result into a speech synthesis result. */
export function speechResultFromSpeakResult(result: SpeakResult): SpeechSynthesisResult {
  if (!result.audioBase64) throw new Error('Speech adapter returned no audio')
  return {
    audioBuffer: new Uint8Array(Buffer.from(result.audioBase64, 'base64')),
    outputFormat: 'mp3',
    fileExtension: 'mp3',
    voiceCompatible: result.playback !== 'renderer',
  }
}

const EDGE_SPEECH_CAPABILITIES: VoiceProviderCapabilities = {
  streaming: true,
  bargeIn: false,
  toolCalls: false,
  browserSession: false,
  languages: ['en', 'ru'],
}

/** Edge TTS as a speech provider; buffered today, chunked by `tts/streaming.ts`. */
export function createEdgeSpeechProvider(options: { speak?: SpeakAdapter } = {}): SpeechProvider {
  const speaker = options.speak ?? createEdgeSpeakAdapter()
  return {
    id: 'edge',
    displayName: 'Edge TTS',
    capabilities: EDGE_SPEECH_CAPABILITIES,
    isConfigured: () => true,
    async synthesize(input) {
      const result = await speaker.speak({ text: input.text, language: input.language as SpeakInputLanguage, signal: input.signal })
      return speechResultFromSpeakResult(result)
    },
  }
}

type SpeakInputLanguage = Parameters<SpeakAdapter['speak']>[0]['language']