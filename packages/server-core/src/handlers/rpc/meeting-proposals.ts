/**
 * Meeting proposal RPC (SPEC §10): list/clarify/approve/reject/execute/status.
 * Actor comes from the RPC session. Approved is not applied until execute.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  MeetingExecutor,
  ProposalInbox,
  approveMeetingProposal,
  type InboxProposal,
} from '../../meetings/index.ts'
import { authorizeMeetingRpc } from '../../meetings/security.ts'
import type { MeetingQueryActor } from '../../meetings/queries.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.meetingProposals.LIST,
  RPC_CHANNELS.meetingProposals.CLARIFY,
  RPC_CHANNELS.meetingProposals.APPROVE,
  RPC_CHANNELS.meetingProposals.REJECT,
  RPC_CHANNELS.meetingProposals.EXECUTE,
  RPC_CHANNELS.meetingProposals.STATUS,
] as const

export type MeetingProposalsHandlerRuntime = {
  resolveActor?: (workspaceId: string) => MeetingQueryActor | Promise<MeetingQueryActor>
  inboxes?: Map<string, ProposalInbox>
  executor?: MeetingExecutor
  grants?: readonly MeetingGrant[]
}

export type ProposalWriteOpts = {
  commandId?: string
  proposalId: string
  payloadHash?: string
  expectedRevision?: number
}

export function registerMeetingProposalsHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
  runtime: MeetingProposalsHandlerRuntime = {},
): void {
  const inboxes = runtime.inboxes ?? new Map<string, ProposalInbox>()
  const executor = runtime.executor ?? new MeetingExecutor({
    idempotent: true,
    mode: 'fixture',
    async execute({ operationId, payload }) {
      return {
        remoteId: typeof payload.remoteId === 'string' ? payload.remoteId : `native-${operationId}`,
        requestId: operationId,
        fields: payload,
      }
    },
    async readback(remoteId) {
      return { remoteId }
    },
  })

  const actorFor = async (workspaceId: string): Promise<MeetingQueryActor> => {
    if (runtime.resolveActor) return runtime.resolveActor(workspaceId)
    return { workspaceId, allowed: true, accountId: 'local-user' }
  }

  const inboxFor = (workspaceId: string): ProposalInbox => {
    const existing = inboxes.get(workspaceId)
    if (existing) return existing
    const created = new ProposalInbox()
    inboxes.set(workspaceId, created)
    return created
  }

  const scoped = (ctx: { workspaceId: string | null }, workspaceId: string, actor: MeetingQueryActor) => {
    const rpc = authorizeMeetingRpc(
      { workspaceId: ctx.workspaceId, accountId: actor.accountId },
      { workspaceId, accountId: actor.accountId },
    )
    if (!rpc.ok) throw Object.assign(new Error(rpc.code), { code: rpc.code })
    if (!actor.allowed) throw Object.assign(new Error('denied'), { code: 'denied' })
    return actor
  }

  server.handle(RPC_CHANNELS.meetingProposals.LIST, async (ctx, workspaceId: string) => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    return { items: inboxFor(workspaceId).list(), state: 'ready' as const }
  })

  server.handle(RPC_CHANNELS.meetingProposals.CLARIFY, async (ctx, workspaceId: string, opts: ProposalWriteOpts) => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    return inboxFor(workspaceId).clarify(opts.proposalId)
  })

  server.handle(RPC_CHANNELS.meetingProposals.APPROVE, async (ctx, workspaceId: string, opts: ProposalWriteOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const inbox = inboxFor(workspaceId)
    const current = inbox.get(opts.proposalId)
    if (!current) throw Object.assign(new Error('not-found'), { code: 'not-found' })
    return approveMeetingProposal(inbox, {
      proposalId: opts.proposalId,
      actorId: actor.accountId ?? 'rpc-session',
      workspaceId,
      deviceId: 'rpc-session',
      payloadHash: opts.payloadHash ?? current.payloadHash,
      baseRevision: opts.expectedRevision ?? current.sourceRevision,
      now: Date.now(),
      grants: runtime.grants ?? [],
    })
  })

  server.handle(RPC_CHANNELS.meetingProposals.REJECT, async (ctx, workspaceId: string, opts: ProposalWriteOpts) => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    return inboxFor(workspaceId).reject(opts.proposalId)
  })

  server.handle(RPC_CHANNELS.meetingProposals.EXECUTE, async (ctx, workspaceId: string, opts: ProposalWriteOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const inbox = inboxFor(workspaceId)
    const proposal = inbox.get(opts.proposalId)
    if (!proposal) throw Object.assign(new Error('not-found'), { code: 'not-found' })
    const job = await executor.executeApprovedProposal({
      proposal,
      actorId: actor.accountId ?? 'rpc-session',
      workspaceId,
      deviceId: 'rpc-session',
      now: Date.now(),
      grants: runtime.grants ?? [],
    })
    if (job.status === 'acked') inbox.markApplied(opts.proposalId)
    return job
  })

  server.handle(RPC_CHANNELS.meetingProposals.STATUS, async (ctx, workspaceId: string, opts: ProposalWriteOpts) => {
    scoped(ctx, workspaceId, await actorFor(workspaceId))
    const proposal = inboxFor(workspaceId).get(opts.proposalId)
    if (!proposal) throw Object.assign(new Error('not-found'), { code: 'not-found' })
    const job = executor.list().find((item) => item.proposalId === opts.proposalId)
    return { proposal, job: job ?? null }
  })
}

export type { InboxProposal }
