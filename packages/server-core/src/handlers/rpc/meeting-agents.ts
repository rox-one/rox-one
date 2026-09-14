/**
 * Meeting agent RPC (SPEC §10): list/configure/readiness/ask/runSkill.
 * Actor comes from the RPC session, not a forged body identity.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  answerMeetingQuestion,
  ensureBuiltinMeetingAgents,
  emptyMeetingAgentStore,
  invokeMeetingSlash,
  readinessFor,
  setMeetingAgentEnabled,
  type AssistTranscriptSegment,
  type BuiltinMeetingAgentId,
  type MeetingAgentStore,
  type MeetingAssistResult,
} from '@craft-agent/shared/meeting-agents'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { authorizeMeetingRpc, inspectUntrustedInput } from '../../meetings/security.ts'
import type { MeetingQueryActor } from '../../meetings/queries.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.meetingAgents.LIST,
  RPC_CHANNELS.meetingAgents.CONFIGURE,
  RPC_CHANNELS.meetingAgents.READINESS,
  RPC_CHANNELS.meetingAgents.ASK,
  RPC_CHANNELS.meetingAgents.RUN_SKILL,
] as const

export type MeetingAgentsHandlerRuntime = {
  resolveActor?: (workspaceId: string) => MeetingQueryActor | Promise<MeetingQueryActor>
  stores?: Map<string, MeetingAgentStore>
}

type AskOpts = {
  commandId?: string
  meetingId?: string
  question?: string
  intent?: 'ask' | 'catch-up'
  transcript?: readonly AssistTranscriptSegment[]
}

type ConfigureOpts = {
  commandId?: string
  id: BuiltinMeetingAgentId
  enabled: boolean
}

type RunSkillOpts = {
  commandId?: string
  meetingId: string
  text: string
}

export function registerMeetingAgentsHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
  runtime: MeetingAgentsHandlerRuntime = {},
): void {
  const stores = runtime.stores ?? new Map<string, MeetingAgentStore>()

  const actorFor = async (workspaceId: string): Promise<MeetingQueryActor> => {
    if (runtime.resolveActor) return runtime.resolveActor(workspaceId)
    return { workspaceId, allowed: true }
  }

  const storeFor = (workspaceId: string): MeetingAgentStore => {
    const existing = stores.get(workspaceId)
    if (existing) return existing
    const created = ensureBuiltinMeetingAgents(workspaceId, '1.0.0', emptyMeetingAgentStore()).store
    stores.set(workspaceId, created)
    return created
  }

  const probe = { available: true }

  const scoped = (ctx: { workspaceId: string | null }, workspaceId: string, actor: MeetingQueryActor) => {
    const rpc = authorizeMeetingRpc(
      { workspaceId: ctx.workspaceId, accountId: actor.accountId },
      { workspaceId, accountId: actor.accountId },
    )
    if (!rpc.ok) throw Object.assign(new Error(rpc.code), { code: rpc.code })
    if (!actor.allowed) throw Object.assign(new Error('denied'), { code: 'denied' })
    return actor
  }

  server.handle(RPC_CHANNELS.meetingAgents.LIST, async (ctx, workspaceId: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const store = storeFor(workspaceId)
    return { items: readinessFor(actor.workspaceId, store, probe), state: 'ready' as const }
  })

  server.handle(RPC_CHANNELS.meetingAgents.READINESS, async (ctx, workspaceId: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const store = storeFor(workspaceId)
    return { items: readinessFor(actor.workspaceId, store, probe), state: 'ready' as const }
  })

  server.handle(RPC_CHANNELS.meetingAgents.CONFIGURE, async (ctx, workspaceId: string, opts: ConfigureOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const next = setMeetingAgentEnabled(storeFor(workspaceId), opts.id, opts.enabled)
    stores.set(workspaceId, next)
    return { items: readinessFor(actor.workspaceId, next, { available: true }), state: 'ready' as const }
  })

  server.handle(RPC_CHANNELS.meetingAgents.ASK, async (ctx, workspaceId: string, opts: AskOpts): Promise<MeetingAssistResult> => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    const texts = [
      opts.question,
      ...(opts.transcript ?? []).map((segment) => segment.text),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    for (const text of texts) {
      const decision = inspectUntrustedInput(text, 'speech')
      if (!decision.ok) {
        return {
          ok: false,
          code: 'forbidden-source',
          message: decision.message,
          citations: [],
          modelCalls: 0,
          externalActions: [],
          policyBypass: false,
          usedScreen: false,
        }
      }
    }
    return answerMeetingQuestion({
      question: opts.question,
      intent: opts.intent ?? 'ask',
      transcript: opts.transcript,
    })
  })

  server.handle(RPC_CHANNELS.meetingAgents.RUN_SKILL, async (ctx, workspaceId: string, opts: RunSkillOpts) => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    return invokeMeetingSlash(opts.text, {
      meetingId: opts.meetingId,
      workspaceId,
      sourceSnapshot: { revision: 1, finalizedWatermark: 1 },
      store: storeFor(workspaceId),
    })
  })
}
