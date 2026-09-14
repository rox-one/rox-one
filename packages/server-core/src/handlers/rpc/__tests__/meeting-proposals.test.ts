import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { ProposalInbox } from '../../../meetings/proposals.ts'
import { HANDLED_CHANNELS, registerMeetingProposalsHandlers } from '../meeting-proposals.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const grant: MeetingGrant = {
  id: 'g1',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'rpc-session',
  capabilities: ['action.external'],
  expiresAt: Date.now() + 60_000,
}

function createHarness() {
  const inbox = new ProposalInbox()
  const proposal = inbox.put({
    id: 'p1',
    workspaceId: 'ws-a',
    meetingId: 'm1',
    payload: { title: 'прототип' },
    sourceRevision: 1,
  })
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  }
  registerMeetingProposalsHandlers(server as unknown as RpcServer, {} as never, {
    resolveActor: (workspaceId) => ({ workspaceId, allowed: true, accountId: 'acct-1' }),
    inboxes: new Map([['ws-a', inbox]]),
    grants: [grant],
  })
  return {
    proposal,
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing ${channel}`)
      return handler({}, ...args) as Promise<T>
    },
  }
}

describe('meetingProposals RPC (SPEC §10)', () => {
  it('registers list/clarify/approve/reject/execute/status', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.meetingProposals.LIST,
      RPC_CHANNELS.meetingProposals.CLARIFY,
      RPC_CHANNELS.meetingProposals.APPROVE,
      RPC_CHANNELS.meetingProposals.REJECT,
      RPC_CHANNELS.meetingProposals.EXECUTE,
      RPC_CHANNELS.meetingProposals.STATUS,
    ])
  })

  it('approves then executes a specific payload hash', async () => {
    const rpc = createHarness()
    const listed = await rpc.invoke<{ items: Array<{ id: string }> }>(RPC_CHANNELS.meetingProposals.LIST, 'ws-a')
    expect(listed.items.map((item) => item.id)).toEqual(['p1'])
    const approved = await rpc.invoke<{ status: string }>(RPC_CHANNELS.meetingProposals.APPROVE, 'ws-a', {
      proposalId: 'p1',
      payloadHash: rpc.proposal.payloadHash,
    })
    expect(approved.status).toBe('approved')
    const executed = await rpc.invoke<{ status: string; result?: { mode?: string; verification?: string } }>(
      RPC_CHANNELS.meetingProposals.EXECUTE,
      'ws-a',
      { proposalId: 'p1' },
    )
    expect(executed.status).toBe('acked')
    expect(executed.result?.mode).toBe('fixture')
    expect(executed.result?.verification).not.toBe('verified')
    const status = await rpc.invoke<{ proposal: { status: string } }>(RPC_CHANNELS.meetingProposals.STATUS, 'ws-a', {
      proposalId: 'p1',
    })
    expect(status.proposal.status).toBe('applied')
  })
})
