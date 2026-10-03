/**
 * feed:* RPC — Лента aggregator. feed:list merges, typed by tab:
 *  - agents: sessions (SessionManager) + automation runs (automations-history.jsonl)
 *  - news / subscriptions: FeedService items (user sources, X home timeline)
 * Team activity lives in the renderer's local-first team store and is merged
 * there. feed:changed is pushed whenever sources/items change.
 * Native actors use workspace-server private custody; legacy Electron keeps device-local state.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, resolveConfigDir } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { CredentialId } from '@craft-agent/shared/credentials'
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
} from '@craft-agent/shared/feed'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { FeedService, type AddSourceResult } from '../../feed/feed-service'
import { createXApiAdapter, notConnectedXAdapter, type XSubscriptionsAdapter } from '../../feed/x-adapter'
import { createNativeFeedOperation, type NativeFeedEnvironment } from './native-feed'
import { CodedError } from '@craft-agent/shared/protocol'
import type { RequestContext } from '../../transport/types'

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

export function registerFeedHandlers(server: RpcServer, deps: HandlerDeps, nativeEnvironment: NativeFeedEnvironment = {}): void {
  const log = deps.platform.logger
  let legacyService: FeedService | null = null
  const legacy = () => {
    if (!legacyService) {
      legacyService = feedService()
      legacyService.onChange = () => pushTyped(server, RPC_CHANNELS.feed.CHANGED, { to: 'all' }, { at: Date.now() })
      legacyService.onStatusChange = legacyService.onChange
      legacyService.start()
    }
    return legacyService
  }
  const nativeLocks = new Map<string, Promise<unknown>>()
  server.onShutdown?.(() => { legacyService?.stop(); nativeLocks.clear() })
  const native = (context: RequestContext, action: 'read' | 'write') => createNativeFeedOperation(server, deps, context, action, nativeEnvironment)
  const nativeWrite = async <T>(context: RequestContext, operation: (feed: ReturnType<typeof native>) => Promise<T> | T): Promise<T> => {
    const scoped = native(context, 'write')
    const previous = nativeLocks.get(scoped.key)
    const pending = (async () => {
      await previous?.catch(() => {})
      scoped.assertCurrent()
      const result = await operation(scoped)
      scoped.assertCurrent()
      return result
    })()
    nativeLocks.set(scoped.key, pending)
    try { return await pending } finally { if (nativeLocks.get(scoped.key) === pending) nativeLocks.delete(scoped.key) }
  }
  const readOptions = { access: 'nativeOrLocalElectron' as const, nativeAction: 'read' as const }
  const writeOptions = { access: 'nativeOrLocalElectron' as const, nativeAction: 'write' as const, timeoutMs: 90_000 }

  server.handle(RPC_CHANNELS.feed.LIST, async (ctx, workspaceId?: string | null): Promise<FeedListResult> => {
    if (ctx.principal) {
      if (workspaceId && workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Feed workspace access denied')
      return native(ctx, 'read').list()
    }
    const svc = legacy()
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
  }, readOptions)

  server.handle(RPC_CHANNELS.feed.SOURCES_ADD, async (ctx, url: string, intervalMin?: number, opts?: FeedAddSourceOptions): Promise<AddSourceResult> => {
    const options = {
      ...(opts && typeof opts === 'object' ? opts : {}),
      ...(typeof intervalMin === 'number' ? { intervalMin } : {}),
    }
    if (ctx.principal) return nativeWrite(ctx, async feed => {
      const result = feed.service.addSource(typeof url === 'string' ? url : '', options)
      if (result.ok) {
        await feed.service.pollSource(result.source.id)
        return { ok: true as const, source: feed.service.listSources().find(source => source.id === result.source.id)! }
      }
      return result
    })
    return legacy().addSource(typeof url === 'string' ? url : '', options)
  }, writeOptions)

  server.handle(RPC_CHANNELS.feed.SOURCES_PREVIEW, async (ctx, url: string): Promise<FeedPreviewResult> => {
    const feed = ctx.principal ? native(ctx, 'read') : null
    const result = await (feed?.service ?? legacy()).preview(typeof url === 'string' ? url : '')
    feed?.assertCurrent()
    return result
  }, readOptions)

  server.handle(RPC_CHANNELS.feed.ITEMS_ANNOTATE, async (ctx, ids: string[] | string, patch: FeedAnnotationPatch) => {
    const values = Array.isArray(ids) ? ids : [ids]
    const update = patch && typeof patch === 'object' ? patch : {}
    if (ctx.principal) return nativeWrite(ctx, feed => {
      const visible = new Set(feed.list().items.map(item => item.id))
      return { updated: feed.service.annotate(values.filter(id => visible.has(id)), update) }
    })
    return { updated: legacy().annotate(values, update) }
  }, writeOptions)

  server.handle(RPC_CHANNELS.feed.SOURCES_REMOVE, async (ctx, id: string) => ctx.principal
    ? nativeWrite(ctx, feed => ({ removed: feed.service.removeSource(String(id)) }))
    : ({ removed: legacy().removeSource(String(id)) }), writeOptions)

  server.handle(RPC_CHANNELS.feed.SOURCES_UPDATE, async (ctx, id: string, patch: FeedSourcePatch) => ctx.principal
    ? nativeWrite(ctx, feed => feed.service.updateSource(String(id), patch ?? {}))
    : legacy().updateSource(String(id), patch ?? {}), writeOptions)

  server.handle(RPC_CHANNELS.feed.REFRESH, async (ctx, id?: string | null) => {
    if (ctx.principal) return nativeWrite(ctx, async feed => {
      if (id === '__due__') await feed.service.tick()
      else await feed.service.refresh(id ?? undefined)
      return { ok: true }
    })
    const svc = legacy()
    await svc.refresh(id ?? undefined)
    return { ok: true }
  }, writeOptions)

  server.handle(RPC_CHANNELS.feed.X_SET_TOKEN, async (ctx, token: string): Promise<XConnectionStatus> => {
    if (ctx.principal) return nativeWrite(ctx, feed => feed.setX(typeof token === 'string' ? token : ''))
    const svc = legacy()
    const value = typeof token === 'string' ? token.trim() : ''
    if (!value) return { state: 'error', message: 'empty-token' }
    const status = await createXApiAdapter(value).status()
    if (status.state !== 'connected') return status
    await getCredentialManager().set(FEED_X_CREDENTIAL, { value, tokenType: 'Bearer' })
    svc.resetX()
    void svc.refresh('x').catch(() => {})
    log.info('feed: X token saved')
    return svc.xStatus(true)
  }, writeOptions)

  server.handle(RPC_CHANNELS.feed.X_CLEAR, async (ctx): Promise<XConnectionStatus> => {
    if (ctx.principal) return nativeWrite(ctx, feed => feed.clearX())
    const svc = legacy()
    await getCredentialManager().delete(FEED_X_CREDENTIAL).catch(() => false)
    svc.resetX()
    pushTyped(server, RPC_CHANNELS.feed.CHANGED, { to: 'all' }, { at: Date.now() })
    return { state: 'not-connected' }
  }, writeOptions)
}
