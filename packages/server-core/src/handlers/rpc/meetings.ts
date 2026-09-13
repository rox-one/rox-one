import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { queryMeetings } from '../../meetings/queries.ts'
import { approveMeetingProposal, rejectMeetingProposal, type ProposalStore } from '../../meetings/proposals.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const proposalStores = new Map<string, ProposalStore>()

function storeFor(workspaceId: string): ProposalStore {
  const existing = proposalStores.get(workspaceId)
  if (existing) return existing
  const created: ProposalStore = { items: [] }
  proposalStores.set(workspaceId, created)
  return created
}

export const MEETING_HANDLED_CHANNELS = [
  RPC_CHANNELS.meetings.LIST,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.APPROVE_PROPOSAL,
  RPC_CHANNELS.meetings.REJECT_PROPOSAL,
] as const

export function registerMeetingHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.meetings.LIST, async (_ctx, workspaceId: string, cursor?: string, limit = 20) => {
    return queryMeetings({
      items: [],
      workspaceId,
      readableWorkspaceId: workspaceId,
      cursor,
      limit,
    })
  })
  server.handle(RPC_CHANNELS.meetings.GET, async (_ctx, workspaceId: string, meetingId: string) => {
    return queryMeetings({
      items: [],
      workspaceId,
      readableWorkspaceId: workspaceId,
      query: meetingId,
      limit: 1,
    }).page[0] ?? null
  })
  server.handle(RPC_CHANNELS.meetings.SEARCH, async (_ctx, workspaceId: string, query: string) => {
    return queryMeetings({
      items: [],
      workspaceId,
      readableWorkspaceId: workspaceId,
      query,
      limit: 50,
    })
  })
  server.handle(RPC_CHANNELS.meetings.APPROVE_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string, actorId: string, grant: MeetingGrant | null, payload: Record<string, unknown>) => {
    return approveMeetingProposal({ store: storeFor(workspaceId), proposalId, actorId, grant, payload })
  })
  server.handle(RPC_CHANNELS.meetings.REJECT_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string) => {
    return rejectMeetingProposal(storeFor(workspaceId), proposalId)
  })
}
