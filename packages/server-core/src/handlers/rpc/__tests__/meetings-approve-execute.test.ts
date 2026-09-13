import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { payloadHash } from '../../../meetings/proposals.ts'
import { PersonalTaskPersistStore } from '../../../tasks/personal-persist.ts'
import { readbackNative } from '../../../meetings/native-actions.ts'
import { createNativeNotesEngine } from '@craft-agent/core/rox2'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
  seedMeetingProposalForTests,
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

describe('meetings RPC APPROVE_PROPOSAL execute+persist', () => {
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

  it('approves then applies create_task with a persist revision, not empty', async () => {
    const handlers = createHarness()
    const payload = { title: 'прототип' }
    const proposal: MeetingProposal = {
      id: 'p1',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
      payloadHash: payloadHash(payload),
      status: 'proposed',
      sourceSpans: [],
      baseRevisions: {},
    }
    seedMeetingProposalForTests(proposal)
    const result = await handlers.get(RPC_CHANNELS.meetings.APPROVE_PROPOSAL)!(
      {},
      'ws',
      'p1',
      'user',
      grant,
      payload,
    ) as {
      proposal: MeetingProposal
      operation: { verification: string; entityRef?: { entityId: string; revisionId: string } }
    }
    expect(result.proposal.status).toBe('applied')
    expect(result.operation.verification).toBe('verified')
    const entityId = result.operation.entityRef?.entityId
    const revision = result.operation.entityRef?.revisionId
    expect(entityId?.startsWith('task:')).toBe(true)
    expect(revision).not.toBe('')
    expect(Number(revision)).toBeGreaterThan(0)

    const persist = new PersonalTaskPersistStore(join(configDir, 'meetings', 'ws'))
    const read = readbackNative(entityId!, createNativeNotesEngine(), new PersonalTaskStore(), persist)
    expect(read?.revision).toBe(revision)
  })

  it('fail-closes apply when CONFIG_DIR is unset', async () => {
    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const handlers = createHarness()
    const payload = { title: 'прототип' }
    seedMeetingProposalForTests({
      id: 'p2',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
      payloadHash: payloadHash(payload),
      status: 'proposed',
      sourceSpans: [],
      baseRevisions: {},
    })
    const result = await handlers.get(RPC_CHANNELS.meetings.APPROVE_PROPOSAL)!(
      {},
      'ws',
      'p2',
      'user',
      grant,
      payload,
    ) as { proposal: MeetingProposal; operation: { error?: { code: string } } }
    expect(result.proposal.status).toBe('approved')
    expect(result.operation.error?.code).toBe('config-dir-required')
  })
})
