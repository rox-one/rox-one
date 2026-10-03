/**
 * Handler tests for Issue 13 memory proposal lifecycle.
 */
import './memory-test-setup'
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot: string
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@rox/shared/config', () => ({
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
    const consentEventId = approved.provenance.consentEventId
    if (!consentEventId) throw new Error('Approval must include a consent event')
    const memory = readFileSync(join(workspaceRoot, 'projects', 'rox', 'MEMORY.md'), 'utf-8')
    expect(memory).toContain('Rox desktop app')
    expect(memory).toContain('sess_learn')
    expect(memory).toContain(consentEventId)
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

describe('memory proposal LLM extraction with regex fallback', () => {
  const input = {
    sessionId: 'sess_ru',
    workspaceId: 'ws1',
    trigger: 'brain' as const,
    messages: [
      { id: 'm1', role: 'user', content: 'Всегда отвечай мне по-русски и коротко.' },
      { id: 'm2', role: 'assistant', content: 'Хорошо, буду отвечать коротко.' },
    ],
  }

  it('uses the model answer and asks for the fast tier', async () => {
    const { extractWithLlmFallback } = await import('./memory-proposals')
    const calls: Array<{ options?: { preferFastModel?: boolean } }> = []
    const result = await extractWithLlmFallback(input, async (_sessionId, _request, options) => {
      calls.push({ options })
      return { text: '{"proposals":[{"text":"Отвечать пользователю по-русски и коротко","kind":"preference","sources":[1]}]}', model: 'rox/fast' }
    })
    expect(calls[0]?.options?.preferFastModel).toBe(true)
    expect(result.source).toBe('llm')
    expect(result.extracted).toHaveLength(1)
    expect(result.extracted[0]?.sourceMessageIds).toEqual(['m1'])
    expect(result.extracted[0]?.cost.model).toBe('rox/fast')
  })

  it('falls back to the RU-aware regex and reports the model error', async () => {
    const { extractWithLlmFallback } = await import('./memory-proposals')
    const result = await extractWithLlmFallback(input, async () => {
      throw new Error('401 Unauthorized: invalid API key')
    })
    expect(result.source).toBe('regex')
    expect(result.warning).toContain('401')
    expect(result.extracted.map((p) => p.sourceMessageIds[0])).toContain('m1')
  })

  it('reports how many messages were scanned through the RPC', async () => {
    const { invoke } = createHarness()
    const extracted = await invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, {
      workspaceId: 'ws1',
      sessionId: 'sess_empty',
      trigger: 'brain',
      messages: [
        { id: 'm1', role: 'user', content: 'Привет' },
        { id: 'm2', role: 'assistant', content: 'Здравствуйте!' },
      ],
    }) as { proposals: unknown[]; scannedMessages: number; source: string }
    expect(extracted.proposals).toEqual([])
    expect(extracted.scannedMessages).toBe(2)
    expect(extracted.source).toBe('regex')
  })
})
