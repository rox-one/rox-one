import type { MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import { isUiVerified } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type NativeProposalType = 'create_task' | 'create_note'

export type MeetingProposalApi = {
  createMeetingProposal(
    workspaceId: string,
    meetingId: string,
    type: NativeProposalType,
    payload: Record<string, unknown>,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ proposal: MeetingProposal | null; error?: { code: string } }>
  approveMeetingProposal(
    workspaceId: string,
    proposalId: string,
    actorId: string,
    grant: MeetingGrant | null,
    payload: Record<string, unknown>,
  ): Promise<{
    proposal: MeetingProposal
    operation: OperationResultV2
  }>
}

export type MeetingProposalRow = {
  id: string
  title: string
  status: MeetingProposal['status']
  source: string
  type: NativeProposalType
  payload: Record<string, unknown>
  revisionId?: string
  errorCode?: string
}

export const PROPOSAL_ERROR_I18N: Record<string, string> = {
  'config-dir-required': 'meetings.configDirRequired',
  'create-failed': 'meetings.createFailed',
  'grant-required': 'meetings.grantRequired',
  'meeting-required': 'meetings.meetingRequired',
  'outbox-required': 'meetings.outboxRequired',
  'payload-conflict': 'meetings.payloadConflict',
  'rpc-unavailable': 'meetings.rpcUnavailable',
  'unsupported-native-kind': 'meetings.unsupportedKind',
  'workspace-required': 'meetings.workspaceRequired',
}

export function i18nKeyForProposalError(code: string | undefined): string {
  if (!code) return 'meetings.approveFailed'
  return PROPOSAL_ERROR_I18N[code] ?? 'meetings.approveFailed'
}

export function buildMeetingGrant(input: {
  workspaceId: string
  actorId: string
  deviceId?: string
}): MeetingGrant {
  return {
    id: `grant-${input.workspaceId}`,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId ?? 'desktop',
    capabilities: ['send'],
  }
}

export function resolveMeetingProposalApi(injected?: MeetingProposalApi | null): MeetingProposalApi | null {
  if (injected) return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.createMeetingProposal || !api?.approveMeetingProposal) return null
  return api
}

export function rowFromProposal(
  proposal: MeetingProposal,
  extras?: { revisionId?: string; errorCode?: string },
): MeetingProposalRow {
  const title = typeof proposal.payload.title === 'string' && proposal.payload.title.length > 0
    ? proposal.payload.title
    : proposal.id
  const type: NativeProposalType = proposal.type === 'create_note' ? 'create_note' : 'create_task'
  return {
    id: proposal.id,
    title,
    status: proposal.status,
    source: 'native',
    type,
    payload: proposal.payload,
    revisionId: extras?.revisionId,
    errorCode: extras?.errorCode,
  }
}

function failClosedGate(input: {
  api: MeetingProposalApi | null
  workspaceId: string | null
  meetingId?: string | null
  grant: MeetingGrant | null
  requireMeeting?: boolean
}): { ok: false; code: string } | {
  ok: true
  api: MeetingProposalApi
  workspaceId: string
  grant: MeetingGrant
  meetingId: string | null
} {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (input.requireMeeting !== false && !input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  return {
    ok: true,
    api: input.api,
    workspaceId: input.workspaceId,
    grant: input.grant,
    meetingId: input.meetingId ?? null,
  }
}

export async function createNativeProposalViaRpc(input: {
  api: MeetingProposalApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
  type: NativeProposalType
  payload: Record<string, unknown>
}): Promise<{ ok: true; row: MeetingProposalRow } | { ok: false; code: string }> {
  const gate = failClosedGate({
    api: input.api,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    grant: input.grant,
  })
  if (!gate.ok) return gate
  if (!gate.meetingId) return { ok: false, code: 'meeting-required' }
  const result = await gate.api.createMeetingProposal(
    gate.workspaceId,
    gate.meetingId,
    input.type,
    input.payload,
    input.actorId,
    gate.grant,
  )
  if (!result.proposal) return { ok: false, code: result.error?.code ?? 'create-failed' }
  return { ok: true, row: rowFromProposal(result.proposal) }
}

export async function approveNativeProposalViaRpc(input: {
  api: MeetingProposalApi | null
  workspaceId: string | null
  actorId: string
  grant: MeetingGrant | null
  row: MeetingProposalRow
}): Promise<{ ok: true; row: MeetingProposalRow } | { ok: false; code: string; row: MeetingProposalRow }> {
  const gate = failClosedGate({
    api: input.api,
    workspaceId: input.workspaceId,
    meetingId: input.row.id,
    grant: input.grant,
    requireMeeting: false,
  })
  if (!gate.ok) return { ok: false, code: gate.code, row: { ...input.row, errorCode: gate.code } }
  const result = await gate.api.approveMeetingProposal(
    gate.workspaceId,
    input.row.id,
    input.actorId,
    gate.grant,
    input.row.payload,
  )
  const errorCode = result.operation.error?.code
  if (errorCode || !isUiVerified(result.operation)) {
    return {
      ok: false,
      code: errorCode ?? 'approve-failed',
      row: rowFromProposal(result.proposal, { errorCode: errorCode ?? 'approve-failed' }),
    }
  }
  const revisionId = result.operation.entityRef?.revisionId
  if (!revisionId) {
    return {
      ok: false,
      code: 'approve-failed',
      row: rowFromProposal(result.proposal, { errorCode: 'approve-failed' }),
    }
  }
  return {
    ok: true,
    row: rowFromProposal(result.proposal, { revisionId }),
  }
}
