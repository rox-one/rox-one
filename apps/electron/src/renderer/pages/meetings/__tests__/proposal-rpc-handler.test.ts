import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '@craft-agent/server-core/handlers/rpc/meetings'
import { loadProposalStore, MeetingJournal, startNativeMeeting } from '@craft-agent/server-core/meetings'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { OperationResultV2 } from '@craft-agent/core/meetings'
import {
  approveNativeProposalViaRpc,
  createNativeProposalViaRpc,
  openNativeProposalTargetViaRpc,
  rejectNativeProposalViaRpc,
  type MeetingOpenTargetApi,
  type MeetingProposalApi,
} from '../proposal-rpc'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function apiFromHandlers(): MeetingProposalApi & MeetingOpenTargetApi {
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
    openMeetingTarget: async (...args) => handlers.get(RPC_CHANNELS.meetings.OPEN_TARGET)!(
      {},
      ...args,
    ) as Promise<{
      target: { kind: 'note' | 'task'; id: string; revisionId: string; entityId: string } | null
      error?: { code: string }
    }>,
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

  function persistRoot(): string {
    return join(configDir, 'meetings', 'ws')
  }

  function startMeeting(meetingId = 'm1'): void {
    const started = startNativeMeeting({
      persistRootDir: persistRoot(),
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'локальная',
      meetingId,
    })
    if (!started.ok) throw new Error('expected start')
  }

  function upserts(meetingId: string) {
    return new MeetingJournal(persistRoot()).read(meetingId).events.filter((event) => event.type === 'proposal.upsert')
  }

  it('create then approve returns persist revision', async () => {
    const api = apiFromHandlers()
    startMeeting()
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
    expect(upserts('m1').map((event) => event.proposal.status)).toEqual(['proposed', 'applied'])
  })

  it('create fail-closes without a meeting and does not persist proposals.json', async () => {
    const api = apiFromHandlers()
    const missing = await createNativeProposalViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'm1',
      actorId: 'user',
      grant,
      type: 'create_task',
      payload: { title: 'прототип' },
    })
    expect(missing).toEqual({ ok: false, code: 'meeting-not-found' })
    expect(existsSync(join(configDir, 'meetings', 'ws', 'proposals.json'))).toBe(false)
    expect(loadProposalStore(persistRoot()).items).toEqual([])
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
    startMeeting()
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
    expect(upserts('m1').map((event) => event.proposal.status)).toEqual(['proposed', 'rejected'])
  })

  it('openTarget navigates only after persist revision verify and fail-closes without CONFIG_DIR', async () => {
    const api = apiFromHandlers()
    startMeeting()
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
    expect(approved.row.entityId?.startsWith('task:')).toBe(true)
    const opened = await openNativeProposalTargetViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: approved.row,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error('expected open')
    expect(opened.route.startsWith('tasks/task/')).toBe(true)
    expect(opened.target.kind).toBe('task')
    expect(opened.target.revisionId).toBe(approved.row.revisionId)
    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await openNativeProposalTargetViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      row: approved.row,
    })
    expect(noDir).toEqual({ ok: false, code: 'config-dir-required' })
  })
})
