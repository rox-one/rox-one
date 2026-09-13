import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { queryMeetings } from '../../meetings/queries.ts'
import { approveMeetingProposal, rejectMeetingProposal, type ProposalStore } from '../../meetings/proposals.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { CalendarOccurrence } from '../../meetings/conation/calendar-calls.ts'
import type { CrmTarget } from '../../meetings/conation/crm.ts'
import {
  approveMailDraft,
  bindCalendarOccurrence,
  joinNativeRoom,
  listMailThreads,
  prepareMailDraft,
  proposeCrmCard,
  sendPreparedMail,
  type MailLedgerEntry,
  type ReminderLedgerEntry,
} from '../../meetings/conation/native-shells.ts'

const proposalStores = new Map<string, ProposalStore>()
const mailLedgers = new Map<string, Map<string, MailLedgerEntry>>()
const reminderLedgers = new Map<string, Map<string, ReminderLedgerEntry>>()
const mailSeen = new Map<string, Set<string>>()

function storeFor(workspaceId: string): ProposalStore {
  const existing = proposalStores.get(workspaceId)
  if (existing) return existing
  const created: ProposalStore = { items: [] }
  proposalStores.set(workspaceId, created)
  return created
}

function mailLedgerFor(workspaceId: string): Map<string, MailLedgerEntry> {
  const existing = mailLedgers.get(workspaceId)
  if (existing) return existing
  const created = new Map<string, MailLedgerEntry>()
  mailLedgers.set(workspaceId, created)
  return created
}

function reminderLedgerFor(workspaceId: string): Map<string, ReminderLedgerEntry> {
  const existing = reminderLedgers.get(workspaceId)
  if (existing) return existing
  const created = new Map<string, ReminderLedgerEntry>()
  reminderLedgers.set(workspaceId, created)
  return created
}

function seenFor(workspaceId: string): Set<string> {
  const existing = mailSeen.get(workspaceId)
  if (existing) return existing
  const created = new Set<string>()
  mailSeen.set(workspaceId, created)
  return created
}

export const MEETING_HANDLED_CHANNELS = [
  RPC_CHANNELS.meetings.LIST,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.APPROVE_PROPOSAL,
  RPC_CHANNELS.meetings.REJECT_PROPOSAL,
  RPC_CHANNELS.meetings.MAIL_PREPARE,
  RPC_CHANNELS.meetings.MAIL_SEND,
  RPC_CHANNELS.meetings.CRM_PROPOSE,
  RPC_CHANNELS.meetings.CALENDAR_BIND,
  RPC_CHANNELS.meetings.ROOM_JOIN,
  RPC_CHANNELS.meetings.MAIL_THREADS,
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
  server.handle(
    RPC_CHANNELS.meetings.MAIL_PREPARE,
    async (_ctx, workspaceId: string, input: { id: string; threadId: string; to: string[]; attachments?: string[] }) => {
      const entry = prepareMailDraft(mailLedgerFor(workspaceId), input)
      return approveMailDraft(mailLedgerFor(workspaceId), entry.id) ?? entry
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.MAIL_SEND,
    async (_ctx, workspaceId: string, draftId: string, credentialsPresent = false) => {
      return sendPreparedMail(
        mailLedgerFor(workspaceId),
        draftId,
        { present: credentialsPresent },
        seenFor(workspaceId),
      )
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.CRM_PROPOSE,
    async (
      _ctx,
      workspaceId: string,
      wanted: { accountId: string; remoteType: CrmTarget['remoteType']; remoteId: string },
      candidates: CrmTarget[],
      credentialsPresent = false,
    ) => {
      void workspaceId
      return proposeCrmCard(candidates, wanted, { present: credentialsPresent }, {
        dealCapability: true,
        baseRevision: '1',
        currentRevision: '1',
      })
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.CALENDAR_BIND,
    async (_ctx, workspaceId: string, row: CalendarOccurrence, credentialsPresent = false) => {
      return bindCalendarOccurrence(row, { present: credentialsPresent }, reminderLedgerFor(workspaceId))
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.ROOM_JOIN,
    async (_ctx, _workspaceId: string, roomId: string, actorId: string) => {
      return joinNativeRoom({ roomId, actorId, recordingConsent: true })
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.MAIL_THREADS,
    async (_ctx, _workspaceId: string, credentialsPresent = false) => {
      return listMailThreads({ present: credentialsPresent })
    },
  )
}
