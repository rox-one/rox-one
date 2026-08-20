/**
 * Main-process helpers for the isolated SiYuan kernel BrowserView session.
 *
 * The kernel desktop UI authenticates via Cookie `siyuan=<AccessAuthCode>`.
 * Tokens stay in the main process (partition persist:knowledge-engine) and
 * are never sent to the renderer.
 */
import { session } from 'electron'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  KnowledgeConnectionsStore,
  SIYUAN_LOCAL_CONNECTION_ID,
  credentialIdFromRef,
  type KnowledgeConnectionRecord,
} from '@craft-agent/server-core/knowledge'

export const KNOWLEDGE_ENGINE_PARTITION = 'persist:knowledge-engine'

export function originFromPageUrl(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function debugCookie(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : error != null ? String(error) : ''
  console.debug(`[siyuan] ${message}${detail ? `: ${detail}` : ''}`)
}

function isSiyuanConnection(c: KnowledgeConnectionRecord): boolean {
  if (c.id === SIYUAN_LOCAL_CONNECTION_ID) return true
  if (c.mode === 'managed') return true
  return c.provider === 'siyuan'
}

async function tokenFromDefaultConnection(): Promise<string | undefined> {
  try {
    const store = new KnowledgeConnectionsStore()
    // `provider` is on KnowledgeConnectionRecord but parseConnectionFile does
    // not require it, so prefer the stable local id / managed mode.
    const record =
      store.get(SIYUAN_LOCAL_CONNECTION_ID) ?? store.list().find(isSiyuanConnection)
    if (!record) return undefined
    const id = credentialIdFromRef(record.credentialRef)
    if (!id) return undefined
    const credential = await getCredentialManager().get(id)
    const value = credential?.value?.trim()
    return value || undefined
  } catch {
    return undefined
  }
}

function setSiyuanCookie(origin: string, token: string): void {
  try {
    const fromPartition = session?.fromPartition
    if (typeof fromPartition !== 'function') {
      debugCookie('knowledge-engine session cookies API missing')
      return
    }
    const ses = fromPartition.call(session, KNOWLEDGE_ENGINE_PARTITION)
    const setter = ses?.cookies?.set
    if (typeof setter !== 'function') {
      debugCookie('knowledge-engine session cookies API missing')
      return
    }
    const result = setter.call(ses.cookies, {
      url: origin,
      name: 'siyuan',
      value: token,
      httpOnly: true,
    })
    void Promise.resolve(result).catch((error: unknown) => {
      debugCookie('knowledge-engine cookie set failed', error)
    })
  } catch (error) {
    debugCookie('knowledge-engine cookie set skipped', error)
  }
}

/**
 * Best-effort: stamp `siyuan` on persist:knowledge-engine for `pageUrl`'s origin.
 * Never throws. Prefers the default knowledge connection credential; falls back
 * to OEM_KERNEL_AUTH_CODE (tests / local kernel inject).
 */
export function ensureKnowledgeEngineAuthCookie(pageUrl: string): void {
  const origin = originFromPageUrl(pageUrl)
  if (!origin) return

  const envToken = process.env.OEM_KERNEL_AUTH_CODE?.trim()
  if (envToken) setSiyuanCookie(origin, envToken)

  void (async () => {
    try {
      const token = await tokenFromDefaultConnection()
      if (token) setSiyuanCookie(origin, token)
    } catch (error) {
      debugCookie('knowledge-engine credential lookup skipped', error)
    }
  })()
}
