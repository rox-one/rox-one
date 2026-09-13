/**
 * Gamification RPC — profile XP/level surface + award hook.
 *
 * State lives in CONFIG_DIR/gamification.json (user-scoped, not workspace).
 * Balance has no billing API yet → null → UI shows em dash.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  applyQuestAction,
  awardXp,
  getGamificationProgress,
  getLevelProgress,
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
} from '@craft-agent/shared/gamification'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveConfigDir } from "@craft-agent/shared/config/paths"

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
    ratings: state.ratings,
    analyticsConsent: state.analyticsConsent,
  }
}

function broadcast(server: RpcServer, state: GamificationState): void {
  pushTyped(server, RPC_CHANNELS.gamification.CHANGED, { to: 'all' }, toDto(state))
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

export function registerGamificationHandlers(server: RpcServer, _deps: HandlerDeps): void {
  setGamificationAwardListener((result) => {
    broadcast(server, result.state)
  })

  server.handle(RPC_CHANNELS.gamification.GET, async () => {
    const { state } = getGamificationProgress()
    return toDto(state)
  })

  server.handle(RPC_CHANNELS.gamification.AWARD, async (_ctx, event: unknown) => {
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
  })

  server.handle(RPC_CHANNELS.gamification.QUEST, async (_ctx, payload: unknown) => {
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
    const { state, analytics } = applyQuestAction(body.action, body.questId as QuestId, {
      cloudFeaturesEnabled: body.cloudFeaturesEnabled !== false,
    })
    broadcast(server, state)
    return { ...toDto(state), analytics }
  })

  server.handle(RPC_CHANNELS.gamification.RATE, async (_ctx, payload: unknown) => {
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
  })

  server.handle(RPC_CHANNELS.gamification.SET_CONSENT, async (_ctx, consent: unknown) => {
    const state = setAnalyticsConsent(consent === true)
    broadcast(server, state)
    return toDto(state)
  })
}

/** Read-only snapshot for non-RPC callers. */
export function getGamificationDto(): GamificationProfileDto {
  return toDto(loadGamificationState())
}