/**
 * feed:* RPC — Лента aggregator. feed:list merges, typed by tab:
 *  - agents: sessions (SessionManager) + automation runs (automations-history.jsonl)
 *  - news / subscriptions: FeedService items (user sources, X home timeline)
 * Team activity lives in the renderer's local-first team store and is merged
 * there. feed:changed is pushed whenever sources/items change.
 * LOCAL_ONLY: sources, items and the X token are device-local.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId, resolveConfigDir } from '@rox/shared/config'
import { getCredentialManager } from '@rox/shared/credentials'
import type { CredentialId } from '@rox/shared/credentials'
import {
  buildAutomationRunItems,
  buildSessionFeedItems,
  mergeFeedItems,
  type FeedAddSourceOptions,
  type FeedAnnotationPatch,
  type FeedAutomationRunLike,
  type FeedListResult,
  type FeedPreviewResult,
  type FeedSourcePatch,
  type FeedSessionLike,
  type XConnectionStatus,
} from '@rox/shared/feed'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { FeedService, type AddSourceResult } from '../../feed/feed-service'
import { createXApiAdapter, notConnectedXAdapter, type XSubscriptionsAdapter } from '../../feed/x-adapter'

export const FEED_HANDLED_CHANNELS = [
  RPC_CHANNELS.feed.LIST,
  RPC_CHANNELS.feed.SOURCES_ADD,
  RPC_CHANNELS.feed.SOURCES_REMOVE,
  RPC_CHANNELS.feed.SOURCES_UPDATE,
  RPC_CHANNELS.feed.REFRESH,
  RPC_CHANNELS.feed.X_SET_TOKEN,
  RPC_CHANNELS.feed.X_CLEAR,
  RPC_CHANNELS.feed.SOURCES_PREVIEW,
  RPC_CHANNELS.feed.ITEMS_ANNOTATE,
] as const

export const FEED_X_CREDENTIAL: CredentialId = { type: 'service_oauth', workspaceId: 'rox-feed', name: 'x' }
const HISTORY_FILE = 'automations-history.jsonl'

let service: FeedService | null = null

async function xAdapter(): Promise<XSubscriptionsAdapter> {
  try {
    const cred = await getCredentialManager().get(FEED_X_CREDENTIAL)
    return cred?.value ? createXApiAdapter(cred.value) : notConnectedXAdapter
  } catch {
    return notConnectedXAdapter
  }
}

export function feedService(configDir: string = resolveConfigDir()): FeedService {
  if (!service) service = new FeedService({ configDir, getXAdapter: xAdapter })
  return service
}

export function resetFeedServiceForTests(next: FeedService | null = null): void {
  service?.stop()
  service = next
}

export async function readAutomationRuns(workspaceRoot: string, limit = 200): Promise<FeedAutomationRunLike[]> {
  try {
    const content = await readFile(join(workspaceRoot, HISTORY_FILE), 'utf-8')
    return content
      .trim()
      .split('\n')
      .slice(-limit)
      .map((l) => { try { return JSON.parse(l) as FeedAutomationRunLike } catch { return null } })
      .filter((e): e is FeedAutomationRunLike => !!e && typeof e.id === 'string' && typeof e.ts === 'number')
  } catch {
    return []
  }
}

export function registerFeedHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  const svc = feedService()
  svc.onChange = () => pushTyped(server, RPC_CHANNELS.feed.CHANGED, { to: 'all' }, { at: Date.now() })
  svc.onStatusChange = svc.onChange
  svc.start()

  server.handle(RPC_CHANNELS.feed.LIST, async (_ctx, workspaceId?: string | null): Promise<FeedListResult> => {
    let sessions: FeedSessionLike[] = []
    try {
      sessions = deps.sessionManager.getSessions(workspaceId ?? undefined) as unknown as FeedSessionLike[]
    } catch (e) {
      log.warn(`feed:list sessions unavailable: ${e instanceof Error ? e.message : e}`)
    }
    const ws = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
    const runs = ws ? await readAutomationRuns(ws.rootPath) : []
    const x = await svc.xStatus().catch((): XConnectionStatus => ({ state: 'not-connected' }))
    return {
      items: mergeFeedItems([buildSessionFeedItems(sessions), buildAutomationRunItems(runs, {}, workspaceId ?? undefined), svc.listItems()], 2000),
      sources: svc.listSources(),
      annotations: svc.listAnnotations(),
      x,
      generatedAt: Date.now(),
    }
  })

  server.handle(RPC_CHANNELS.feed.SOURCES_ADD, async (_ctx, url: string, intervalMin?: number, opts?: FeedAddSourceOptions): Promise<AddSourceResult> =>
    svc.addSource(typeof url === 'string' ? url : '', {
      ...(opts && typeof opts === 'object' ? opts : {}),
      ...(typeof intervalMin === 'number' ? { intervalMin } : {}),
    }))

  server.handle(RPC_CHANNELS.feed.SOURCES_PREVIEW, async (_ctx, url: string): Promise<FeedPreviewResult> =>
    svc.preview(typeof url === 'string' ? url : ''))

  server.handle(RPC_CHANNELS.feed.ITEMS_ANNOTATE, async (_ctx, ids: string[] | string, patch: FeedAnnotationPatch) => ({
    updated: svc.annotate(Array.isArray(ids) ? ids : [ids], patch && typeof patch === 'object' ? patch : {}),
  }))

  server.handle(RPC_CHANNELS.feed.SOURCES_REMOVE, async (_ctx, id: string) => ({ removed: svc.removeSource(String(id)) }))

  server.handle(RPC_CHANNELS.feed.SOURCES_UPDATE, async (_ctx, id: string, patch: FeedSourcePatch) =>
    svc.updateSource(String(id), patch ?? {}))

  server.handle(RPC_CHANNELS.feed.REFRESH, async (_ctx, id?: string | null) => {
    await svc.refresh(id ?? undefined)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.feed.X_SET_TOKEN, async (_ctx, token: string): Promise<XConnectionStatus> => {
    const value = typeof token === 'string' ? token.trim() : ''
    if (!value) return { state: 'error', message: 'empty-token' }
    const status = await createXApiAdapter(value).status()
    if (status.state !== 'connected') return status
    await getCredentialManager().set(FEED_X_CREDENTIAL, { value, tokenType: 'Bearer' })
    svc.resetX()
    void svc.refresh('x').catch(() => {})
    log.info('feed: X token saved')
    return svc.xStatus(true)
  })

  server.handle(RPC_CHANNELS.feed.X_CLEAR, async (): Promise<XConnectionStatus> => {
    await getCredentialManager().delete(FEED_X_CREDENTIAL).catch(() => false)
    svc.resetX()
    pushTyped(server, RPC_CHANNELS.feed.CHANGED, { to: 'all' }, { at: Date.now() })
    return { state: 'not-connected' }
  })
}
