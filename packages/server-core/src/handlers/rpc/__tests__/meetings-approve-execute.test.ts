import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { PersonalTaskPersistStore } from '../../../tasks/personal-persist.ts'
import { MeetingNotePersistStore } from '../../../meetings/note-persist.ts'
import { readbackNative } from '../../../meetings/native-actions.ts'
import { createNativeNotesEngine } from '@craft-agent/core/rox2'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { approveAndExecuteNative } from '../../../meetings/approve-execute.ts'
import { loadProposalStore } from '../../../meetings/proposals.ts'
import { startNativeMeeting } from '../../../meetings/catalog.ts'
import { MeetingJournal } from '../../../meetings/journal.ts'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '../meetings.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

function createHarness() {
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
  return handlers
}

describe('meetings RPC createProposal then APPROVE_PROPOSAL', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-rpc-'))
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

  function operationResults(meetingId: string) {
    return new MeetingJournal(persistRoot()).read(meetingId).events.filter((event) => event.type === 'operation.result')
  }

  it('create then approve applies persist revision without test-only seeding', async () => {
    const handlers = createHarness()
    startMeeting()
    const payload = { title: 'прототип' }
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      grant,
    ) as { proposal: MeetingProposal | null; error?: { code: string } }
    expect(created.error).toBeUndefined()
    expect(created.proposal?.status).toBe('proposed')
    expect(existsSync(join(configDir, 'meetings', 'ws', 'proposals.json'))).toBe(true)
    expect(upserts('m1')).toHaveLength(1)
    expect(upserts('m1')[0]?.proposal.status).toBe('proposed')

    const result = await handlers.get(RPC_CHANNELS.meetings.APPROVE_PROPOSAL)!(
      {},
      'ws',
      created.proposal!.id,
      'user',
      grant,
      payload,
    ) as {
      proposal: MeetingProposal
      operation: { verification: string; entityRef?: { entityId: string; revisionId: string } }
    }
    expect(result.proposal.status).toBe('applied')
    expect(result.operation.verification).toBe('pending')
    expect(result.operation.verification).not.toBe('verified')
    expect(upserts('m1').map((event) => event.proposal.status)).toEqual(['proposed', 'applied'])
    expect(operationResults('m1')).toHaveLength(1)
    expect(operationResults('m1')[0]?.result.verification).toBe('pending')
    expect(operationResults('m1')[0]?.result.verification).not.toBe('verified')
    expect(operationResults('m1')[0]?.result.mode).toBe('fixture')
    expect(operationResults('m1')[0]?.result.operationId).toBe(created.proposal!.id)
    const entityId = result.operation.entityRef?.entityId
    const revision = result.operation.entityRef?.revisionId
    expect(entityId?.startsWith('task:')).toBe(true)
    expect(revision).not.toBe('')
    expect(Number(revision)).toBeGreaterThan(0)

    const persist = new PersonalTaskPersistStore(join(configDir, 'meetings', 'ws'))
    const notesPersist = new MeetingNotePersistStore(join(configDir, 'meetings', 'ws'))
    const read = readbackNative(entityId!, createNativeNotesEngine(), new PersonalTaskStore(), persist, notesPersist)
    expect(read?.revision).toBe(revision)
  })

  it('create survives handler reset so approve does not need seedMeetingProposalForTests', async () => {
    const handlers = createHarness()
    startMeeting()
    const payload = { title: 'прототип' }
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      grant,
    ) as { proposal: MeetingProposal }
    expect(created.proposal.status).toBe('proposed')
    resetMeetingHandlerStateForTests()
    const restarted = createHarness()
    const result = await restarted.get(RPC_CHANNELS.meetings.APPROVE_PROPOSAL)!(
      {},
      'ws',
      created.proposal.id,
      'user',
      grant,
      payload,
    ) as { proposal: MeetingProposal; operation: { verification: string } }
    expect(result.proposal.status).toBe('applied')
    expect(result.operation.verification).toBe('pending')
    expect(result.operation.verification).not.toBe('verified')
    expect(loadProposalStore(join(configDir, 'meetings', 'ws')).items[0]?.status).toBe('applied')
  })

  it('create fail-closes without grant or CONFIG_DIR', async () => {
    const handlers = createHarness()
    const payload = { title: 'прототип' }
    const noGrant = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      null,
    ) as { proposal: MeetingProposal | null; error?: { code: string } }
    expect(noGrant.proposal).toBeNull()
    expect(noGrant.error?.code).toBe('grant-required')
    expect(existsSync(join(configDir, 'meetings', 'ws', 'proposals.json'))).toBe(false)

    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      grant,
    ) as { proposal: MeetingProposal | null; error?: { code: string } }
    expect(noDir.proposal).toBeNull()
    expect(noDir.error?.code).toBe('config-dir-required')
  })

  it('create fail-closes without a meeting and does not persist proposals.json', async () => {
    const handlers = createHarness()
    const payload = { title: 'прототип' }
    const missing = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      grant,
    ) as { proposal: MeetingProposal | null; error?: { code: string } }
    expect(missing.proposal).toBeNull()
    expect(missing.error?.code).toBe('meeting-not-found')
    expect(existsSync(join(configDir, 'meetings', 'ws', 'proposals.json'))).toBe(false)
  })

  it('approve after create is still fail-closed without outbox', async () => {
    const handlers = createHarness()
    startMeeting()
    const payload = { title: 'прототип' }
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE_PROPOSAL)!(
      {},
      'ws',
      'm1',
      'create_task',
      payload,
      'user',
      grant,
    ) as { proposal: MeetingProposal }
    const persistRootDir = join(configDir, 'meetings', 'ws')
    const result = approveAndExecuteNative({
      store: loadProposalStore(persistRootDir),
      proposalId: created.proposal.id,
      actorId: 'user',
      grant,
      payload,
      jobs: null,
      persistRootDir,
    })
    expect(result.proposal.status).toBe('approved')
    expect(result.operation.error?.code).toBe('outbox-required')
    expect(new PersonalTaskPersistStore(persistRootDir).list()).toEqual([])
  })
})
