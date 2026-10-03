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
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { approveMemoryProposalDurably } from '../../memory/approve-memory-proposal'
import { LessonStore } from '../../memory/LessonStore'
import type { MemoryProposal } from '@rox/shared/memory/proposals'

function createHarness(context?: Partial<RequestContext>, sessionManager?: Partial<HandlerDeps['sessionManager']>, current?: () => boolean) {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
    ...(current ? { isRequestContextCurrent: current } : {}),
  }
  const deps: HandlerDeps = {
    sessionManager: (sessionManager ?? {}) as HandlerDeps['sessionManager'],
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
    return handler({ clientId: 'c1', workspaceId: null, webContentsId: null, ...context } as RequestContext, ...args)
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

describe('durable approval, ownership and recovery', () => {
  function savedProposal(owner?: { issuer: string; subject: string }): { store: MemoryProposalStore; proposal: MemoryProposal } {
    const store = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    const proposal: MemoryProposal = {
      id: 'mp_durable', text: 'Always preserve the current document', kind: 'rule', status: 'pending',
      sessionId: 'sess1', workspaceId: 'ws1', projectId: 'proj_rox', ...(owner ? { owner } : {}),
      sourceMessageIds: ['m1'], provenance: { trigger: 'brain' }, riskFlags: [], conflicts: [], editHistory: [],
      createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', cost: { tokens: 10, model: 'rox/fast' },
    }
    store.save(proposal)
    return { store, proposal }
  }

  it('never approves a missing project or a failed target write', () => {
    const { store, proposal } = savedProposal()
    expect(() => approveMemoryProposalDurably({ store, workspaceRoot, proposalId: proposal.id, scope: 'project', projectId: 'missing' })).toThrow('Project memory target not found')
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).get(proposal.id)?.status).toBe('pending')
    mkdirSync(join(workspaceRoot, 'projects', 'rox', 'MEMORY.md'))
    expect(() => approveMemoryProposalDurably({ store, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'project' })).toThrow()
    const reloaded = new MemoryProposalStore(join(workspaceRoot, 'memory')).get(proposal.id)
    expect(reloaded?.status).toBe('pending')
    expect(reloaded?.approval?.writtenAt).toBeUndefined()
  })

  it('recovers after target write but before status commit without duplicating project memory', () => {
    const { store, proposal } = savedProposal()
    const save = store.save.bind(store)
    let writes = 0
    store.save = (value) => {
      if (++writes === 2) throw new Error('simulated status disk failure')
      return save(value)
    }
    expect(() => approveMemoryProposalDurably({ store, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'project' })).toThrow('status disk failure')
    const path = join(workspaceRoot, 'projects', 'rox', 'MEMORY.md')
    const before = readFileSync(path, 'utf8')
    const reloaded = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    expect(reloaded.get(proposal.id)?.status).toBe('pending')
    const result = approveMemoryProposalDurably({ store: reloaded, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'project' })
    expect(result?.status).toBe('approved_project')
    expect(result?.approval?.writtenAt).toBeTruthy()
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(approveMemoryProposalDurably({ store: reloaded, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'project' })?.approval).toEqual(result?.approval)
  })

  it('writes an explicit workspace target without touching legacy global lessons', () => {
    const { store, proposal } = savedProposal()
    const result = approveMemoryProposalDurably({ store, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'workspace' })
    expect(result?.status).toBe('approved_workspace')
    const lessons = new LessonStore(join(workspaceRoot, 'memory', 'lessons.jsonl'), 'workspace').list()
    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.scope).toBe('workspace')
    expect(lessons[0]?.source.proposalId).toBe(proposal.id)
    expect(existsSync(join(configDir, 'memory', 'lessons.jsonl'))).toBe(false)
  })

  it('confirms a deduplicated lesson with different letter case and recovers its receipt after reload', () => {
    const { store, proposal } = savedProposal()
    const lessons = new LessonStore(join(workspaceRoot, 'memory', 'lessons.jsonl'), 'workspace')
    lessons.add({ ts: proposal.createdAt, rule: proposal.text.toLowerCase(), category: 'general', scope: 'workspace', source: { sessionId: 'earlier', trigger: 'explicit' } })
    const save = store.save.bind(store)
    let writes = 0
    store.save = value => {
      if (++writes === 2) throw new Error('simulated status disk failure')
      return save(value)
    }
    expect(() => approveMemoryProposalDurably({ store, workspaceRoot, proposalId: proposal.id, scope: 'workspace' })).toThrow('status disk failure')
    const result = approveMemoryProposalDurably({ store: new MemoryProposalStore(join(workspaceRoot, 'memory')), workspaceRoot, proposalId: proposal.id, scope: 'workspace' })
    expect(result?.status).toBe('approved_workspace')
    expect(result?.approval?.writtenAt).toBeTruthy()
    expect(new LessonStore(lessons.filePath, 'workspace').list()).toHaveLength(1)
  })

  it('requires a verified personal owner and isolates authenticated lessons', () => {
    const owner = { issuer: 'test', subject: 'alice' }
    const { store, proposal } = savedProposal(owner)
    expect(() => approveMemoryProposalDurably({ store, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'personal' })).toThrow('authenticated owner')
    const result = approveMemoryProposalDurably({ store, workspaceRoot: workspaceRoot, proposalId: proposal.id, scope: 'personal', owner })
    expect(result?.status).toBe('approved_personal')
    const lessons = new LessonStore(join(configDir, 'memory', 'lessons.jsonl'), 'global')
    expect(lessons.listForOwner(owner)).toHaveLength(1)
    expect(lessons.listForOwner({ issuer: 'test', subject: 'bob' })).toHaveLength(0)
    expect(lessons.listForOwner()).toHaveLength(0)
  })

  it('rejects stale workspace bindings and hides another author’s proposals', async () => {
    const owner = { issuer: 'test', subject: 'alice' }
    savedProposal(owner)
    const stale = createHarness({ workspaceId: 'foreign' })
    await expect(stale.invoke(RPC_CHANNELS.memory.LIST_PROPOSALS, 'ws1')).rejects.toThrow('Workspace access denied')
    const principal = { issuer: 'test', subject: 'bob' } as RequestContext['principal']
    const other = createHarness({ workspaceId: 'ws1', principal })
    expect(await other.invoke(RPC_CHANNELS.memory.LIST_PROPOSALS, 'ws1')).toEqual([])
    await expect(other.invoke(RPC_CHANNELS.memory.APPROVE_PROPOSAL, 'ws1', 'mp_durable', 'personal')).rejects.toThrow('owner access denied')
  })
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

  for (const native of [false, true]) {
    it(`rejects a foreign or missing canonical session before any ${native ? 'native' : 'local'} LLM call`, async () => {
      let calls = 0
      const context: Partial<RequestContext> = { workspaceId: 'ws1',
        ...(native ? { principal: { issuer: 'test', subject: 'alice' } as RequestContext['principal'] } : {}) }
      const { invoke } = createHarness(context, {
        getSessions: () => [{ id: 'owned', workspaceId: 'ws1' }, { id: 'foreign', workspaceId: 'ws2' }] as ReturnType<HandlerDeps['sessionManager']['getSessions']>,
        querySessionLlm: async () => { calls++; return { text: '{"proposals":[]}' } },
      })
      for (const sessionId of ['foreign', 'missing']) {
        await expect(invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, { ...input, sessionId })).rejects.toThrow('Memory session workspace access denied')
      }
      expect(calls).toBe(0)
      expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(0)
      await invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, { ...input, sessionId: 'owned' })
      expect(calls).toBe(1)
    })
  }

  it('rechecks the extraction grant before the provider and after its awaited result', async () => {
    let current = false
    let calls = 0
    const reply = Promise.withResolvers<{ text: string }>()
    const started = Promise.withResolvers<void>()
    const { invoke } = createHarness({ workspaceId: 'ws1' }, {
      getSessions: () => [{ id: input.sessionId, workspaceId: 'ws1' }] as ReturnType<HandlerDeps['sessionManager']['getSessions']>,
      querySessionLlm: async () => { calls++; started.resolve(); return reply.promise },
    }, () => current)
    await expect(invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, input)).rejects.toThrow('no longer authorized')
    expect(calls).toBe(0)
    current = true
    const pending = invoke(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, input)
    await started.promise
    current = false
    reply.resolve({ text: '{"proposals":[{"text":"Keep a private rule","kind":"rule","sources":[1]}]}' })
    await expect(pending).rejects.toThrow('no longer authorized')
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(0)
  })

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
