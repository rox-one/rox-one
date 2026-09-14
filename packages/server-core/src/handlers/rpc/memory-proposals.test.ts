/**
 * Handler tests for Issue 13 memory proposal lifecycle.
 */
import './memory-test-setup'
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot: string
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
  getWorkspaces: () => [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }],
}))

import { registerMemoryProposalHandlers } from './memory-proposals'
import { registerMemoryHandlers } from './memory'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerMemoryHandlers(server, deps)
  registerMemoryProposalHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }
  return { invoke }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mem-prop-ws-'))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(join(workspaceRoot, 'projects', 'rox'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'projects', 'rox', 'config.json'), JSON.stringify({
    id: 'proj_rox',
    name: 'Rox',
    slug: 'rox',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('memory proposal RPC (Issue 13)', () => {
  it('extracts, edits, and approves a project-scoped rule into project MEMORY.md', async () => {
    const { invoke } = createHarness()
    const extracted = await invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, {
      workspaceId: 'ws1',
      sessionId: 'sess_learn',
      projectId: 'proj_rox',
      trigger: 'brain',
      messages: [{ id: 'm1', role: 'user', content: 'Always run bun test before marking a change done.' }],
    }) as { disabled: boolean; proposals: Array<{ id: string; text: string }> }

    expect(extracted.disabled).toBe(false)
    expect(extracted.proposals.length).toBeGreaterThan(0)
    const id = extracted.proposals[0]!.id

    const approved = await invoke(
      RPC_CHANNELS.memory.APPROVE_PROPOSAL,
      'ws1',
      id,
      'project',
      'Always run bun test for the Rox desktop app',
      'proj_rox',
    ) as { status: string; projectId: string; sessionId: string; provenance: { consentEventId?: string }; text: string }

    expect(approved.status).toBe('approved_project')
    expect(approved.projectId).toBe('proj_rox')
    expect(approved.sessionId).toBe('sess_learn')
    expect(approved.provenance.consentEventId).toBeTruthy()
    if (!approved.provenance.consentEventId) throw new Error('expected persisted consent event')
    const memory = readFileSync(join(workspaceRoot, 'projects', 'rox', 'MEMORY.md'), 'utf-8')
    expect(memory).toContain('Rox desktop app')
    expect(memory).toContain('sess_learn')
    expect(memory).toContain(approved.provenance.consentEventId)
    expect(existsSync(join(configDir, 'memory', 'lessons.jsonl'))).toBe(false)
  })

  it('does not extract when workspace learning is disabled', async () => {
    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
      id: 'ws1',
      name: 'ws1',
      slug: 'ws1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      memory: { enabled: false },
    }))
    const { invoke } = createHarness()
    const extracted = await invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, {
      workspaceId: 'ws1',
      sessionId: 'sess_learn',
      trigger: 'close',
      messages: [{ id: 'm1', role: 'user', content: 'Always remember this rule forever.' }],
    }) as { disabled: boolean; proposals: unknown[] }
    expect(extracted.disabled).toBe(true)
    expect(extracted.proposals).toEqual([])
  })

  it('rejects and deletes pending proposals without writing lessons', async () => {
    const { invoke } = createHarness()
    const extracted = await invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, {
      workspaceId: 'ws1',
      sessionId: 'sess_1',
      trigger: 'activity',
      messages: [{ id: 'm1', role: 'user', content: 'Never commit secrets to git.' }],
    }) as { proposals: Array<{ id: string }> }
    const id = extracted.proposals[0]!.id
    const rejected = await invoke(RPC_CHANNELS.memory.REJECT_PROPOSAL, 'ws1', id) as { status: string }
    expect(rejected.status).toBe('rejected')
    expect(await invoke(RPC_CHANNELS.memory.DELETE_PROPOSAL, 'ws1', id)).toBe(true)
    const listed = await invoke(RPC_CHANNELS.memory.LIST_PROPOSALS, 'ws1') as Array<{ id: string; status: string }>
    expect(listed.some((p) => p.id === id)).toBe(false)
  })
})
