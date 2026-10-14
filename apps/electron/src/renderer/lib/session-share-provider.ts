/**
 * Session share-by-link (top50 #19) behind an interface.
 *
 * The account-level share service is meant to live in rox-id
 * (/workspace/out/identity-api.md). Contract v1 has no share endpoints, so the
 * rox-id provider reports itself unavailable and the app falls back to the
 * existing viewer publication (`shareToViewer` / `revokeShare` session
 * commands). When rox-id ships `POST /me/shares` & co., only
 * `createRoxIdShareProvider` changes.
 */
import type { SessionCommand } from '@rox/shared/protocol'
import { createSessionLink } from './session-sharing'

export interface SessionShareLink {
  url: string
  expiresAt?: number
  provider: SessionShareProviderId
}

export type SessionShareProviderId = 'rox-id' | 'viewer'

export interface SessionShareProvider {
  id: SessionShareProviderId
  /** False while the backing service lacks the endpoints (or the user isn't signed in). */
  available(): boolean
  create(sessionId: string): Promise<SessionShareLink>
  revoke(sessionId: string): Promise<void>
}

type SessionCommandApi = (sessionId: string, command: SessionCommand) => Promise<unknown>

export function createViewerShareProvider(command: SessionCommandApi): SessionShareProvider {
  return {
    id: 'viewer',
    available: () => true,
    async create(sessionId) {
      const link = await createSessionLink(command, sessionId, 'share')
      return { url: link.url, expiresAt: link.expiresAt, provider: 'viewer' }
    },
    async revoke(sessionId) {
      const result = await command(sessionId, { type: 'revokeShare' }) as { success?: boolean; error?: string } | undefined
      if (result && result.success === false) throw new Error(result.error || 'revoke-failed')
    },
  }
}

export interface RoxIdShareContract {
  /** Present once identity-api.md publishes share endpoints. */
  createShare?(sessionId: string): Promise<{ url: string; expiresAt?: string }>
  revokeShare?(sessionId: string): Promise<void>
}

export function createRoxIdShareProvider(contract: RoxIdShareContract): SessionShareProvider {
  return {
    id: 'rox-id',
    available: () => typeof contract.createShare === 'function' && typeof contract.revokeShare === 'function',
    async create(sessionId) {
      if (!contract.createShare) throw new Error('rox-id-share-unavailable')
      const r = await contract.createShare(sessionId)
      const at = r.expiresAt ? Date.parse(r.expiresAt) : NaN
      return { url: r.url, ...(Number.isFinite(at) ? { expiresAt: at } : {}), provider: 'rox-id' }
    },
    async revoke(sessionId) {
      if (!contract.revokeShare) throw new Error('rox-id-share-unavailable')
      await contract.revokeShare(sessionId)
    },
  }
}

/** First available provider wins (rox-id before the legacy viewer). */
export function chooseShareProvider(providers: readonly SessionShareProvider[]): SessionShareProvider | null {
  return providers.find((p) => p.available()) ?? null
}

/** App default: rox-id (no endpoints in contract v1 yet) → viewer. */
export function defaultShareProvider(): SessionShareProvider | null {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.sessionCommand) return null
  return chooseShareProvider([createRoxIdShareProvider({}), createViewerShareProvider(api.sessionCommand)])
}
