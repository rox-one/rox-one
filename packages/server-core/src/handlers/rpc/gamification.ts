/**
 * Gamification RPC — profile XP/level surface + award hook.
 *
 * State lives in CONFIG_DIR/gamification.json (user-scoped, not workspace).
 * Balance has no billing API yet → null → UI shows em dash.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import {
  applyQuestAction,
  awardXp,
  getGamificationProgress,
  getLevelProgress,
  getWeeklyXp,
  QUEST_IDS,
  isQuestId,
  isXpEventType,
  loadGamificationState,
  saveSessionRating,
  setAnalyticsConsent,
  setGamificationAwardListener,
  visibleQuests,
  type AwardXpResult,
  type GamificationState,
  type QuestId,
  type QuestRecord,
  type SessionRating,
  type XpEventType,
} from '@rox/shared/gamification'
import type { RpcServer } from '@rox/server-core/transport'
import { pushTyped } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext } from '../../transport/types'
import { NativeGamificationStore } from './native-gamification'
import {
  isClaimableLive,
  rpcGamificationActResult,
  rpcGamificationListResult,
  rpcGamificationReadResult,
} from '@rox/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamification.GET,
  RPC_CHANNELS.gamification.AWARD,
  RPC_CHANNELS.gamification.QUEST,
  RPC_CHANNELS.gamification.RATE,
  RPC_CHANNELS.gamification.SET_CONSENT,
] as const

export type GamificationProfileDto = {
  xp: number
  level: number
  balance: number | null
  progress: number
  xpIntoLevel: number
  xpForNext: number
  nextThreshold: number | null
  currentThreshold: number
  displayNameHint?: string
  recentEvents?: Array<{ type: XpEventType; xp: number; at: number }>
  quests: QuestRecord[]
  questRecords: QuestRecord[]
  weeklyXp: { current: number; previous: number }
  ratings: SessionRating[]
  analyticsConsent: boolean
}

function toDto(state: GamificationState): GamificationProfileDto {
  const progress = getLevelProgress(state.xp)
  return {
    xp: state.xp,
    level: progress.level,
    balance: state.balance,
    progress: progress.progress,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNext: progress.xpForNext,
    nextThreshold: progress.nextThreshold,
    currentThreshold: progress.currentThreshold,
    recentEvents: state.recentEvents,
    quests: visibleQuests(state.quests),
    questRecords: QUEST_IDS.map(id => state.quests[id]),
    weeklyXp: getWeeklyXp(state),
    ratings: state.ratings,
    analyticsConsent: state.analyticsConsent,
  }
}

function broadcast(server: RpcServer, state: GamificationState): void {
  pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'all' }, toDto(state))
}

const nativeStores = new WeakMap<RpcServer, NativeGamificationStore>()
function nativeStoreFor(server: RpcServer, deps: HandlerDeps): NativeGamificationStore {
  let store = nativeStores.get(server)
  if (!store) {
    if (!deps.nativeData) throw new Error('Native XP custody unavailable')
    store = new NativeGamificationStore(deps.nativeData.authority.stateDirectory)
    nativeStores.set(server, store)
    server.onShutdown?.(() => { store?.close(); nativeStores.delete(server) })
  }
  return store
}

/** Best-effort trusted product hook. Never falls back to the host profile. */
export function awardNativeXpAndBroadcast(
  server: RpcServer, deps: HandlerDeps, ctx: RequestContext, event: XpEventType, receiptId: string,
): AwardXpResult | null {
  try {
    if (!ctx.principal || !ctx.workspaceId || !deps.nativeData) return null
    if (!deps.nativeData.authority.authorize(ctx.principal, ctx.workspaceId, 'write')) return null
    if (server.isRequestContextCurrent?.(ctx, 'write') !== true) return null
    const result = nativeStoreFor(server, deps).award(ctx.principal, event, receiptId)
    if (result.awarded) pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'client', clientId: ctx.clientId }, toDto(result.state))
    return result
  } catch { return null }
}

/** Best-effort award used by product hooks. Never throws. */
export function awardXpAndBroadcast(
  server: RpcServer | null | undefined,
  event: XpEventType,
): AwardXpResult | null {
  try {
    const result = awardXp(event)
    if (server) broadcast(server, result.state)
    return result
  } catch {
    return null
  }
}

export function registerGamificationHandlers(server: RpcServer, deps: HandlerDeps): void {
  const ownStore = (ctx: RequestContext): NativeGamificationStore => {
    if (!ctx.principal || !ctx.workspaceId || !deps.nativeData) throw new Error('Native XP profile unavailable')
    // XP and consent are own-profile metadata. A workspace read grant suffices,
    // as with the caller's display name; canonical workspace data is untouched.
    if (!deps.nativeData.authority.authorize(ctx.principal, ctx.workspaceId, 'read')) throw new Error('Native XP profile denied')
    if (server.isRequestContextCurrent?.(ctx, 'read') !== true) throw new Error('Native XP request scope changed')
    return nativeStoreFor(server, deps)
  }
  setGamificationAwardListener((result) => {
    broadcast(server, result.state)
  })

  server.handle(RPC_CHANNELS.gamification.GET, async (ctx) => {
    const listed = rpcGamificationListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('gamification profile is not live')
    const read = rpcGamificationReadResult({ source: 'native', nativeId: 'profile' })
    if (!isClaimableLive(read.result)) throw new Error('gamification profile is not live')
    if (ctx.principal) return toDto(ownStore(ctx).read(ctx.principal))
    const { state } = getGamificationProgress()
    return toDto(state)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.gamification.AWARD, async (_ctx, event: unknown) => {
    const act = rpcGamificationActResult({ source: 'native', action: 'write', nativeId: 'award' })
    if (!isClaimableLive(act)) throw new Error('gamification award is not live')
    if (!isXpEventType(event)) {
      throw new Error(`Unknown XP event: ${String(event)}`)
    }
    const result = awardXp(event)
    // listener already broadcasts; return full award payload
    return {
      ...toDto(result.state),
      awarded: result.awarded,
      event: result.event,
      leveledUp: result.leveledUp,
      previousLevel: result.previousLevel,
    }
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.gamification.QUEST, async (ctx, payload: unknown) => {
    const act = rpcGamificationActResult({ source: 'native', action: 'write', nativeId: 'quest' })
    if (!isClaimableLive(act)) throw new Error('gamification quest is not live')
    if (!payload || typeof payload !== 'object') {
      throw new Error('quest payload required')
    }
    const body = payload as { action?: unknown; questId?: unknown; cloudFeaturesEnabled?: unknown }
    if (body.action !== 'complete' && body.action !== 'dismiss' && body.action !== 'snooze') {
      throw new Error('Unknown quest action')
    }
    if (!isQuestId(body.questId)) {
      throw new Error(`Unknown quest: ${String(body.questId)}`)
    }
    const options = { cloudFeaturesEnabled: body.cloudFeaturesEnabled !== false }
    const { state, analytics } = ctx.principal
      ? ownStore(ctx).quest(ctx.principal, body.action, body.questId, options)
      : applyQuestAction(body.action, body.questId, options)
    if (ctx.principal) pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'client', clientId: ctx.clientId }, toDto(state))
    else broadcast(server, state)
    return { ...toDto(state), analytics }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.gamification.RATE, async (_ctx, payload: unknown) => {
    const act = rpcGamificationActResult({ source: 'native', action: 'write', nativeId: 'rate' })
    if (!isClaimableLive(act)) throw new Error('gamification rate is not live')
    if (!payload || typeof payload !== 'object') {
      throw new Error('rating payload required')
    }
    const body = payload as { sessionId?: unknown; score?: unknown; feedback?: unknown; provenance?: unknown }
    if (typeof body.sessionId !== 'string' || !body.sessionId) {
      throw new Error('sessionId required')
    }
    const score = typeof body.score === 'number' ? body.score : Number.NaN
    if (score < 1 || score > 100 || !Number.isFinite(score)) {
      throw new Error('score must be 1-100')
    }
    const { state, analytics } = saveSessionRating({
      sessionId: body.sessionId,
      score,
      feedback: typeof body.feedback === 'string' ? body.feedback : undefined,
      provenance: typeof body.provenance === 'string' ? body.provenance : undefined,
    })
    broadcast(server, state)
    return { ...toDto(state), analytics }
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.gamification.SET_CONSENT, async (ctx, consent: unknown) => {
    const act = rpcGamificationActResult({ source: 'native', action: 'write', nativeId: 'consent' })
    if (!isClaimableLive(act)) throw new Error('gamification consent write is not live')
    if (typeof consent !== 'boolean') throw new Error('Analytics consent must be boolean')
    const state = ctx.principal ? ownStore(ctx).consent(ctx.principal, consent) : setAnalyticsConsent(consent)
    if (ctx.principal) pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'client', clientId: ctx.clientId }, toDto(state))
    else broadcast(server, state)
    return toDto(state)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
}

/** Read-only snapshot for non-RPC callers. */
export function getGamificationDto(): GamificationProfileDto {
  return toDto(loadGamificationState())
}
