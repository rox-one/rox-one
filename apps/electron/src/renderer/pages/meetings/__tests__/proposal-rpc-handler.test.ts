import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '@craft-agent/server-core/handlers/rpc/meetings'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { OperationResultV2 } from '@craft-agent/core/meetings'
import {
  approveNativeProposalViaRpc,
  createNativeProposalViaRpc,
  rejectNativeProposalViaRpc,
  type MeetingProposalApi,
} from '../proposal-rpc'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function apiFromHandlers(): MeetingProposalApi {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerMeetingHandlers(server as unknown as RpcServer, {
    platform: { logger: console },
  } as never)
  return {
    createMeetingProposal: async (...args) => handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      ...args,
    ) as Promise<{ proposal: MeetingProposal | null; error?: { code: string } }>,
    approveMeetingProposal: async (...args) => handlers.get(RPC_CHANNELS.meetings.APPROVE_PROPOSAL)!(
      {},
      ...args,
    ) as Promise<{ proposal: MeetingProposal; operation: OperationResultV2 }>,
    rejectMeetingProposal: async (...args) => handlers.get(RPC_CHANNELS.meetings.REJECT_PROPOSAL)!(
      {},
      ...args,
    ) as Promise<{ proposal: MeetingProposal | null; error?: { code: string } }>,
  }
}

describe('meetings UI client against CREATE_PROPOSAL + APPROVE_PROPOSAL handlers', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''
  const grant = {
    id: 'g',
    actorId: 'user',
    workspaceId: 'ws',
    deviceId: 'desktop',
    capabilities: ['send'] as const,
  }

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-ui-rpc-'))
    process.env.ROX_CONFIG_DIR = configDir
    delete process.env.CRAFT_CONFIG_DIR
  })

  afterEach(() => {
    resetMeetingHandlerStateForTests()
    if (previousRox === undefined) delete process.env.ROX_CONFIG_DIR
    else process.env.ROX_CONFIG_DIR = previousRox
    if (previousCraft === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = previousCraft
    rmSync(configDir, { recursive: true, force: true })
  })

  it('create then approve returns persist revision', async () => {
    const api = apiFromHandlers()
    const created = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected create')
    const approved = await approveNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: created.row,
    })
    expect(approved.ok).toBe(true)
    if (!approved.ok) throw new Error('expected approve')
    expect(approved.row.status).toBe('applied')
    expect(Number(approved.row.revisionId)).toBeGreaterThan(0)
  })

  it('create fail-closes without grant or CONFIG_DIR', async () => {
    const api = apiFromHandlers()
    const noGrant = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant: null,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(noGrant).toEqual({ ok: false, code: 'grant-required' })
    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(noDir).toEqual({ ok: false, code: 'config-dir-required' })
  })

  it('reject persist is fail-closed without grant or CONFIG_DIR and does not invent a revision', async () => {
    const api = apiFromHandlers()
    const created = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected create')
    const noGrant = await rejectNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      row: created.row,
    })
    expect(noGrant.ok).toBe(false)
    if (noGrant.ok) throw new Error('expected grant fail')
    expect(noGrant.code).toBe('grant-required')
    expect(noGrant.row.status).toBe('proposed')
    expect(noGrant.row.revisionId).toBeUndefined()
    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await rejectNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: created.row,
    })
    expect(noDir.ok).toBe(false)
    if (noDir.ok) throw new Error('expected config fail')
    expect(noDir.code).toBe('config-dir-required')
    expect(noDir.row.status).toBe('proposed')
    process.env.ROX_CONFIG_DIR = configDir
    const rejected = await rejectNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: created.row,
    })
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) throw new Error('expected reject')
    expect(rejected.row.status).toBe('rejected')
    expect(rejected.row.revisionId).toBeUndefined()
  })
})
