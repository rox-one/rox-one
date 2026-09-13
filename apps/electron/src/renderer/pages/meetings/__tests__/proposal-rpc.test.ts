import { describe, expect, it } from 'bun:test'
import type { MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  approveNativeProposalViaRpc,
  buildMeetingGrant,
  createNativeProposalViaRpc,
  i18nKeyForProposalError,
  resolveMeetingProposalApi,
  type MeetingProposalApi,
} from '../proposal-rpc'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

function proposal(status: MeetingProposal['status'] = 'proposed'): MeetingProposal {
  return {
    id: 'prop-m1-abc',
    workspaceId: 'ws',
    meetingId: 'm1',
    type: 'create_task',
    payload: { title: 'прототип' },
    payloadHash: 'h',
    status,
    sourceSpans: [],
    baseRevisions: {},
  }
}

function verified(): OperationResultV2 {
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'succeeded',
    verification: 'verified',
    operationId: 'op',
    entityRef: { workspaceId: 'ws', entityId: 'task:1', revisionId: '3' },
  }
}

function failed(code: string): OperationResultV2 {
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'failed',
    verification: 'not_requested',
    operationId: 'op',
    error: { code, retryable: false, safeMessage: code },
  }
}

describe('meetings proposal RPC client', () => {
  it('maps fail-closed codes to i18n keys', () => {
    expect(i18nKeyForProposalError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForProposalError('config-dir-required')).toBe('meetings.configDirRequired')
    expect(i18nKeyForProposalError('outbox-required')).toBe('meetings.outboxRequired')
    expect(i18nKeyForProposalError('rpc-unavailable')).toBe('meetings.rpcUnavailable')
    expect(i18nKeyForProposalError('workspace-required')).toBe('meetings.workspaceRequired')
  })

  it('fail-closes create without api, workspace, meeting, or grant and does not call RPC', async () => {
    const calls: unknown[] = []
    const api: MeetingProposalApi = {
      createMeetingProposal: async (...args) => {
        calls.push(args)
        return { proposal: proposal() }
      },
      approveMeetingProposal: async () => ({ proposal: proposal('applied'), operation: verified() }),
    }
    expect(await createNativeProposalViaRpc({
      api: null,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await createNativeProposalViaRpc({
      api,
      workspaceId: null,
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })).toEqual({ ok: false, code: 'workspace-required' })
    expect(await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: null,
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })).toEqual({ ok: false, code: 'meeting-required' })
    expect(await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant: null,
      type: 'create_task',
      payload: { title: 'прототип' },
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(calls).toEqual([])
  })

  it('create and approve go through RPC args and surface persist revision', async () => {
    const created = proposal()
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingProposalApi = {
      createMeetingProposal: async (...args) => {
        calls.push({ channel: 'meetings:createProposal', args })
        return { proposal: created }
      },
      approveMeetingProposal: async (...args) => {
        calls.push({ channel: 'meetings:approveProposal', args })
        return { proposal: { ...created, status: 'applied' }, operation: verified() }
      },
    }
    const createdResult = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(createdResult.ok).toBe(true)
    if (!createdResult.ok) throw new Error('expected create')
    expect(createdResult.row.status).toBe('proposed')
    expect(createdResult.row.revisionId).toBeUndefined()
    const approved = await approveNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: createdResult.row,
    })
    expect(approved.ok).toBe(true)
    if (!approved.ok) throw new Error('expected approve')
    expect(approved.row.status).toBe('applied')
    expect(approved.row.revisionId).toBe('3')
    expect(calls[0]?.channel).toBe('meetings:createProposal')
    expect(calls[0]?.args).toEqual(['ws', 'm1', 'create_task', { title: 'прототип' }, 'user', grant])
    expect(calls[1]?.channel).toBe('meetings:approveProposal')
    expect(calls[1]?.args).toEqual(['ws', 'prop-m1-abc', 'user', grant, { title: 'прототип' }])
  })

  it('approve fail-closes on grant/configDir/outbox without inventing a revision', async () => {
    const api: MeetingProposalApi = {
      createMeetingProposal: async () => ({ proposal: proposal() }),
      approveMeetingProposal: async () => ({
        proposal: proposal('approved'),
        operation: failed('outbox-required'),
      }),
    }
    const row = {
      id: 'prop-m1-abc',
      title: 'прототип',
      status: 'proposed' as const,
      source: 'native',
      type: 'create_task' as const,
      payload: { title: 'прототип' },
    }
    const noGrant = await approveNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      row,
    })
    expect(noGrant.ok).toBe(false)
    if (noGrant.ok) throw new Error('expected fail')
    expect(noGrant.code).toBe('grant-required')
    expect(noGrant.row.revisionId).toBeUndefined()
    expect(noGrant.row.status).toBe('proposed')

    const outbox = await approveNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row,
    })
    expect(outbox.ok).toBe(false)
    if (outbox.ok) throw new Error('expected outbox fail')
    expect(outbox.code).toBe('outbox-required')
    expect(outbox.row.revisionId).toBeUndefined()
    expect(outbox.row.status).toBe('approved')
  })

  it('does not resolve window.electronAPI when create/approve are missing', () => {
    expect(resolveMeetingProposalApi(null)).toBeNull()
    expect(buildMeetingGrant({ workspaceId: 'ws', actorId: 'user' }).capabilities).toEqual(['send'])
  })
})
