/**
 * License/security review for `agisota/grok-bot-0.18-reconstructed`.
 *
 * Issue 29 requires this review before reuse. Embedding the reconstructed
 * UI is rejected: unknown license, not a Rox-native surface, and it would
 * mix a third-party shell into session chrome. Rox exposes a native tab
 * that talks to typed sandbox contracts instead.
 */

export const GROK_BOT_SOURCE = 'agisota/grok-bot-0.18-reconstructed' as const

export const GROK_BOT_REUSE_DECISION = {
  source: GROK_BOT_SOURCE,
  reuse: 'rejected' as const,
  embedRawUi: false,
  nativeSurface: 'rox-sandbox-tab',
  reasons: [
    'license-unverified',
    'raw-ui-not-rox-native',
    'typed-contracts-required',
  ],
} as const

export type GrokBotReuseDecision = typeof GROK_BOT_REUSE_DECISION

export function mayEmbedGrokBotUi(): boolean {
  return false
}
