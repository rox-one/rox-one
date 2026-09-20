import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getEnv } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { Meeting, MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import { deleteMeeting, getMeeting, queryMeetings, type MeetingQueryActor } from '../../meetings/queries.ts'
import { listNativeMeetings, startNativeMeeting, searchNativeMeetings } from '../../meetings/catalog.ts'
import { loadMeetingQueryIndex, saveMeetingQueryIndex } from '../../meetings/query-store.ts'
import { applyNativeCaptureIntent, type CaptureIntentAction } from '../../meetings/capture.ts'
import { applyNativeImportIntent, type ImportIntentSpec } from '../../meetings/import.ts'
import { applyNativeFinalizeIntent } from '../../meetings/finalize.ts'
import { applyNativeManualNote, applyNativeSegmentCorrection, type ManualNoteSpec, type SegmentCorrectionSpec } from '../../meetings/manual.ts'
import { rejectMeetingProposal, createMeetingProposal, loadProposalStore, saveProposalStore, type ProposalStore } from '../../meetings/proposals.ts'
import { appendProposalJournalEvent } from '../../meetings/proposal-journal.ts'
import { appendOperationResultEvent } from '../../meetings/operation-journal.ts'
import { approveAndExecuteNative, type NativeExecuteRuntime } from '../../meetings/approve-execute.ts'
import { createNativeActionHarness, openNativePersistTarget } from '../../meetings/native-actions.ts'
import type { OutboxJob } from '../../meetings/executor.ts'
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
import { gateMeetingConationShell } from '@craft-agent/core/rox2'

const proposalStores = new Map<string, ProposalStore>()
const jobStores = new Map<string, OutboxJob[]>()
const nativeRuntimes = new Map<string, NativeExecuteRuntime>()
const mailLedgers = new Map<string, Map<string, MailLedgerEntry>>()
const reminderLedgers = new Map<string, Map<string, ReminderLedgerEntry>>()
const mailSeen = new Map<string, Set<string>>()

function storeFor(workspaceId: string): ProposalStore {
  const existing = proposalStores.get(workspaceId)
  if (existing) return existing
  const persistRoot = meetingPersistRoot(workspaceId)
  const created = persistRoot ? loadProposalStore(persistRoot) : { items: [] }
  proposalStores.set(workspaceId, created)
  return created
}

function persistStore(workspaceId: string, store: ProposalStore): void {
  const persistRoot = meetingPersistRoot(workspaceId)
  if (!persistRoot) return
  saveProposalStore(persistRoot, store)
}

function jobsFor(workspaceId: string): OutboxJob[] {
  const existing = jobStores.get(workspaceId)
  if (existing) return existing
  const created: OutboxJob[] = []
  jobStores.set(workspaceId, created)
  return created
}

/** Explicit ROX/CRAFT CONFIG_DIR only. Home-default is not a persist root here. */
export function meetingPersistRoot(workspaceId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const configDir = getEnv('CONFIG_DIR', env)
  if (!configDir) return null
  return join(configDir, 'meetings', workspaceId)
}

function runtimeFor(workspaceId: string, persistRootDir: string): NativeExecuteRuntime {
  const existing = nativeRuntimes.get(workspaceId)
  if (existing) return existing
  const created = createNativeActionHarness(persistRootDir)
  nativeRuntimes.set(workspaceId, created)
  return created
}

export function resetMeetingHandlerStateForTests(): void {
  proposalStores.clear()
  jobStores.clear()
  nativeRuntimes.clear()
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

function journalFailOperation(operationId: string, code: string): OperationResultV2 {
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'failed',
    verification: 'not_requested',
    operationId,
    error: { code, retryable: true, safeMessage: code },
  }
}

function catalogItems(workspaceId: string): Meeting[] {
  const persistRoot = meetingPersistRoot(workspaceId)
  if (!persistRoot) return []
  return listNativeMeetings(persistRoot).filter((item) => item.workspaceId === workspaceId)
}

export const MEETING_HANDLED_CHANNELS = [
  RPC_CHANNELS.meetings.LIST,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.DELETE,
  RPC_CHANNELS.meetings.CREATE,
  RPC_CHANNELS.meetings.CREATE_PROPOSAL,
  RPC_CHANNELS.meetings.APPROVE_PROPOSAL,
  RPC_CHANNELS.meetings.REJECT_PROPOSAL,
  RPC_CHANNELS.meetings.OPEN_TARGET,
  RPC_CHANNELS.meetings.MAIL_PREPARE,
  RPC_CHANNELS.meetings.MAIL_SEND,
  RPC_CHANNELS.meetings.CRM_PROPOSE,
  RPC_CHANNELS.meetings.CALENDAR_BIND,
  RPC_CHANNELS.meetings.ROOM_JOIN,
  RPC_CHANNELS.meetings.MAIL_THREADS,
  RPC_CHANNELS.meetings.START_CAPTURE,
  RPC_CHANNELS.meetings.PAUSE_CAPTURE,
  RPC_CHANNELS.meetings.STOP_CAPTURE,
  RPC_CHANNELS.meetings.IMPORT_MEDIA,
  RPC_CHANNELS.meetings.FINALIZE,
  RPC_CHANNELS.meetings.ADD_MANUAL_NOTE,
  RPC_CHANNELS.meetings.CORRECT_SEGMENT,
] as const

export function registerMeetingHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.meetings.LIST, async (_ctx, workspaceId: string, cursor?: string, limit = 20) => {
    return queryMeetings({
      items: catalogItems(workspaceId),
      workspaceId,
      readableWorkspaceId: workspaceId,
      cursor,
      limit,
    })
  })
  server.handle(RPC_CHANNELS.meetings.GET, async (_ctx, workspaceId: string, meetingId: string) => {
    return catalogItems(workspaceId).find((item) => item.meetingId === meetingId) ?? null
  })
  server.handle(RPC_CHANNELS.meetings.SEARCH, async (_ctx, workspaceId: string, query: string) => {
    const persistRootDir = meetingPersistRoot(workspaceId)
    if (!persistRootDir) return { page: [], continueCursor: null, denied: false, error: { code: 'config-dir-required' } }
    const searched = searchNativeMeetings({
      persistRootDir,
      workspaceId,
      query: typeof query === 'string' ? query : '',
    })
    if (!searched.ok) return { page: [], continueCursor: null, denied: false, error: { code: searched.code } }
    return { page: searched.page, continueCursor: searched.continueCursor, denied: false }
  })
  server.handle(RPC_CHANNELS.meetings.DELETE, async (ctx, workspaceId: string, id: string) => {
    const actor: MeetingQueryActor = {
      workspaceId,
      allowed: ctx.workspaceId == null || ctx.workspaceId === workspaceId,
    }
    if (!actor.allowed) {
      throw Object.assign(new Error('denied'), { code: 'denied' })
    }
    const persistRootDir = meetingPersistRoot(workspaceId)
    if (!persistRootDir) {
      throw Object.assign(new Error('denied'), { code: 'denied' })
    }
    const stored = await loadMeetingQueryIndex(persistRootDir)
    const known = new Map(stored.map((item) => [item.id, item]))
    for (const item of catalogItems(workspaceId)) {
      if (!known.has(item.meetingId)) {
        known.set(item.meetingId, {
          id: item.meetingId,
          workspaceId: item.workspaceId,
          title: item.title,
          updatedAt: item.updatedAt,
        })
      }
    }
    const next = deleteMeeting([...known.values()], id, actor)
    await saveMeetingQueryIndex(persistRootDir, next)
    return getMeeting(next, id, actor)
  })
  server.handle(
    RPC_CHANNELS.meetings.CREATE,
    async (_ctx, workspaceId: string, title: string, actorId: string, grant: MeetingGrant | null) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const created = startNativeMeeting({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        title,
      })
      if (!created.ok) return { meeting: null, error: { code: created.code } }
      return { meeting: created.meeting }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.CREATE_PROPOSAL,
    async (
      _ctx,
      workspaceId: string,
      meetingId: string,
      type: MeetingProposal['type'],
      payload: Record<string, unknown>,
      actorId: string,
      grant: MeetingGrant | null,
    ) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { proposal: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { proposal: null, error: { code: 'config-dir-required' } }
      const store = storeFor(workspaceId)
      const priorIds = new Set(store.items.map((item) => item.id))
      const created = createMeetingProposal({
        store,
        actorId,
        grant,
        workspaceId,
        meetingId,
        type,
        payload,
      })
      if (!created.ok) return { proposal: null, error: { code: created.code } }
      const journaled = appendProposalJournalEvent({
        persistRootDir,
        workspaceId,
        proposal: created.proposal,
      })
      if (!journaled.ok) {
        if (!priorIds.has(created.proposal.id)) {
          const idx = store.items.findIndex((item) => item.id === created.proposal.id)
          if (idx >= 0) store.items.splice(idx, 1)
        }
        return { proposal: null, error: { code: journaled.code } }
      }
      persistStore(workspaceId, store)
      return { proposal: created.proposal }
    },
  )
  server.handle(RPC_CHANNELS.meetings.APPROVE_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string, actorId: string, grant: MeetingGrant | null, payload: Record<string, unknown>) => {
    const persistRootDir = meetingPersistRoot(workspaceId)
    const store = storeFor(workspaceId)
    const result = approveAndExecuteNative({
      store,
      proposalId,
      actorId,
      grant,
      payload,
      jobs: jobsFor(workspaceId),
      persistRootDir,
      runtime: persistRootDir ? runtimeFor(workspaceId, persistRootDir) : undefined,
    })
    if (persistRootDir && result.proposal.status !== 'proposed') {
      const journaled = appendProposalJournalEvent({
        persistRootDir,
        workspaceId,
        proposal: result.proposal,
      })
      if (!journaled.ok) {
        persistStore(workspaceId, store)
        if (result.operation.verification === 'verified') {
          return { proposal: result.proposal, operation: journalFailOperation(result.proposal.id, journaled.code) }
        }
        return result
      }
      const opJournaled = appendOperationResultEvent({
        persistRootDir,
        workspaceId,
        meetingId: result.proposal.meetingId,
        result: result.operation,
      })
      if (!opJournaled.ok) {
        persistStore(workspaceId, store)
        if (result.operation.verification === 'verified') {
          return { proposal: result.proposal, operation: journalFailOperation(result.proposal.id, opJournaled.code) }
        }
        return result
      }
    }
    persistStore(workspaceId, store)
    return result
  })
  server.handle(
    RPC_CHANNELS.meetings.REJECT_PROPOSAL,
    async (_ctx, workspaceId: string, proposalId: string, actorId: string, grant: MeetingGrant | null) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { proposal: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { proposal: null, error: { code: 'config-dir-required' } }
      const store = storeFor(workspaceId)
      const previousStatus = store.items.find((item) => item.id === proposalId)?.status
      const rejected = rejectMeetingProposal({
        store,
        proposalId,
        actorId,
        grant,
      })
      if (!rejected.ok) return { proposal: null, error: { code: rejected.code } }
      const journaled = appendProposalJournalEvent({
        persistRootDir,
        workspaceId,
        proposal: rejected.proposal,
      })
      if (!journaled.ok) {
        if (previousStatus && previousStatus !== rejected.proposal.status) {
          rejected.proposal.status = previousStatus
        }
        return { proposal: null, error: { code: journaled.code } }
      }
      persistStore(workspaceId, store)
      return { proposal: rejected.proposal }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.MAIL_PREPARE,
    async (_ctx, workspaceId: string, input: { id: string; threadId: string; to: string[]; attachments?: string[] }) => {
      const entry = prepareMailDraft(mailLedgerFor(workspaceId), input)
      return gateMeetingConationShell('mail', approveMailDraft(mailLedgerFor(workspaceId), entry.id) ?? entry)
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.MAIL_SEND,
    async (_ctx, workspaceId: string, draftId: string, credentialsPresent = false) => {
      return gateMeetingConationShell(
        'mail',
        sendPreparedMail(
          mailLedgerFor(workspaceId),
          draftId,
          { present: credentialsPresent },
          seenFor(workspaceId),
        ),
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
      return gateMeetingConationShell(
        'crm',
        proposeCrmCard(candidates, wanted, { present: credentialsPresent }, {
          dealCapability: true,
          baseRevision: '1',
          currentRevision: '1',
        }),
      )
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.CALENDAR_BIND,
    async (_ctx, workspaceId: string, row: CalendarOccurrence, credentialsPresent = false) => {
      return gateMeetingConationShell(
        'calendar',
        bindCalendarOccurrence(row, { present: credentialsPresent }, reminderLedgerFor(workspaceId)),
      )
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.ROOM_JOIN,
    async (_ctx, _workspaceId: string, roomId: string, actorId: string) => {
      return gateMeetingConationShell('room', joinNativeRoom({ roomId, actorId, recordingConsent: true }))
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.MAIL_THREADS,
    async (_ctx, _workspaceId: string, credentialsPresent = false) => {
      return gateMeetingConationShell('mail', listMailThreads({ present: credentialsPresent }))
    },
  )
  function handleCapture(action: CaptureIntentAction) {
    return async (_ctx: unknown, workspaceId: string, meetingId: string, actorId: string, grant: MeetingGrant | null) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const result = applyNativeCaptureIntent({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        meetingId,
        action,
      })
      if (!result.ok) return { meeting: null, error: { code: result.code } }
      return { meeting: result.meeting }
    }
  }
  server.handle(RPC_CHANNELS.meetings.START_CAPTURE, handleCapture('start'))
  server.handle(RPC_CHANNELS.meetings.PAUSE_CAPTURE, handleCapture('pause'))
  server.handle(RPC_CHANNELS.meetings.STOP_CAPTURE, handleCapture('stop'))
  server.handle(
    RPC_CHANNELS.meetings.IMPORT_MEDIA,
    async (_ctx, workspaceId: string, meetingId: string, actorId: string, grant: MeetingGrant | null, spec: ImportIntentSpec) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const result = applyNativeImportIntent({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        meetingId,
        spec,
      })
      if (!result.ok) return { meeting: null, error: { code: result.code } }
      return { meeting: result.meeting }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.FINALIZE,
    async (_ctx, workspaceId: string, meetingId: string, actorId: string, grant: MeetingGrant | null) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const result = applyNativeFinalizeIntent({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        meetingId,
      })
      if (!result.ok) return { meeting: null, error: { code: result.code } }
      return { meeting: result.meeting }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.ADD_MANUAL_NOTE,
    async (_ctx, workspaceId: string, meetingId: string, actorId: string, grant: MeetingGrant | null, spec: ManualNoteSpec) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const result = applyNativeManualNote({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        meetingId,
        spec,
      })
      if (!result.ok) return { meeting: null, error: { code: result.code } }
      return { meeting: result.meeting }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.CORRECT_SEGMENT,
    async (_ctx, workspaceId: string, meetingId: string, actorId: string, grant: MeetingGrant | null, spec: SegmentCorrectionSpec) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { meeting: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { meeting: null, error: { code: 'config-dir-required' } }
      const result = applyNativeSegmentCorrection({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        meetingId,
        spec,
      })
      if (!result.ok) return { meeting: null, error: { code: result.code } }
      return { meeting: result.meeting }
    },
  )
  server.handle(
    RPC_CHANNELS.meetings.OPEN_TARGET,
    async (
      _ctx,
      workspaceId: string,
      entityId: string,
      revisionId: string,
      actorId: string,
      grant: MeetingGrant | null,
    ) => {
      const persistRootDir = meetingPersistRoot(workspaceId)
      if (!grant) return { target: null, error: { code: 'grant-required' } }
      if (!persistRootDir) return { target: null, error: { code: 'config-dir-required' } }
      const runtime = runtimeFor(workspaceId, persistRootDir)
      const opened = openNativePersistTarget({
        persistRootDir,
        workspaceId,
        actorId,
        grant,
        entityId,
        revisionId,
        notes: runtime.notes,
        tasks: runtime.tasks,
        persist: runtime.persist,
        notesPersist: runtime.notesPersist,
      })
      if (!opened.ok) return { target: null, error: { code: opened.code } }
      return {
        target: {
          kind: opened.kind,
          id: opened.id,
          revisionId: opened.revisionId,
          entityId: opened.entityId,
        },
      }
    },
  )
}
