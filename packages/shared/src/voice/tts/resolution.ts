/**
 * TTS provider resolution precedence.
 *
 * An explicit user preference wins, then a persona voice, then workspace
 * configuration, then the model attached to the requested voice. A candidate is
 * only honoured when it names an available provider; otherwise resolution falls
 * through to the documented fallback and, failing that, to any available provider.
 *
 * Provenance: OpenClaw `src/tts/tts-provider-resolution.ts` (clean-room
 * re-expression; ledger d1.4).
 */

export interface TtsProviderInputs {
  /** Explicit per-request or saved preference. */
  preference?: string
  /** Persona-bound provider. */
  persona?: string
  /** Workspace/TTS configuration default. */
  config?: string
  /** Provider inferred from the selected voice/model. */
  voiceModel?: string
}

export const TTS_PROVIDER_PRECEDENCE: readonly (keyof TtsProviderInputs)[] = [
  'preference',
  'persona',
  'config',
  'voiceModel',
]

export function resolveTtsProviderId(
  inputs: TtsProviderInputs,
  available: readonly string[],
  fallback: string,
): string {
  if (!available.length) throw new Error('No speech provider is available')
  for (const key of TTS_PROVIDER_PRECEDENCE) {
    const candidate = inputs[key]
    if (typeof candidate === 'string' && candidate && available.includes(candidate)) return candidate
  }
  if (available.includes(fallback)) return fallback
  return available[0]!
}