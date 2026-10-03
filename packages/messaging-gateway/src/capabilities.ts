import type { PlatformType } from './types'

/**
 * Capabilities of this app's current connection flow, not a claim of provider
 * account-history import. The gateway only exposes live message events and
 * message sending; none of its adapters implements a history-import API.
 */
export interface MessagingProviderCapabilities {
  importsHistory: false
}

export const MESSAGING_PROVIDER_CAPABILITIES: Record<PlatformType, MessagingProviderCapabilities> = {
  telegram: { importsHistory: false },
  discord: { importsHistory: false },
  lark: { importsHistory: false },
  wechat: { importsHistory: false },
  whatsapp: { importsHistory: false },
}
