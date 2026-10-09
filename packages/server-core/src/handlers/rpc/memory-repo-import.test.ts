import './memory-test-setup'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  HANDLED_CHANNELS,
  registerMemoryRepoImportHandlers,
  type MemoryRepoImportRuntime,
  type MemoryRepoImportRuntimeAccessor,
} from './memory-repo-import'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { repoRuleHash } from '../../memory/repo/repo-import-parser'
import { setRepoNotifier } from '../../memory/repo/notify'
import { ownerKey8For } from '../../memory/repo/RepoSourceProvider'

let workspaceRoot: string
let runtime: MemoryRepoImportRuntime | null

function lessonFileContent(id: string, rule: string, baseHash?: string): string {
  return [
    '---',
    `id: ${id}`,
    'scope: workspace',
    'category: workflow',
    'disabled: false',
    ...(baseHash ? [`baseHash: ${baseHash}`] : []),
    '---',
    rule,
    '',
  ].join('\n')
}

function makeRuntime(over: Partial<MemoryRepoImportRuntime> = {}): MemoryRepoImportRuntime {
  return {
    bankId: 'ws:ws1',
    scope: 'workspace',
    workspaceId: 'ws1',
    workspaceRoot,
    memoryDir: join(workspaceRoot, 'memory'),
    files: [],
    known: [],
    ...over,
  }
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const actions = new Map<string, string | undefined>()
  const server: RpcServer = {
    handle(channel, handler, options) {
      handlers.set(channel, handler)
      actions.set(channel, options?.nativeAction)
    },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  } as unknown as HandlerDeps
  const accessor: MemoryRepoImportRuntimeAccessor = async () => runtime
  registerMemoryRepoImportHandlers(server, deps, accessor)
  const invoke = (channel: string, context: Partial<RequestContext>, ...args: unknown[]): unknown => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null, webContentsId: null, ...context } as RequestContext, ...args)
  }
  return { handlers, actions, invoke }
}

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'mem-repo-import-')))
  runtime = null
})

afterEach(() => {
  setRepoNotifier(null)
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('registerMemoryRepoImportHandlers', () => {
  it('registers exactly the channels it declares', () => {
    const { handlers } = createHarness()
    expect(new Set(handlers.keys())).toEqual(new Set(HANDLED_CHANNELS))
    expect(handlers.size).toBe(HANDLED_CHANNELS.length)
  })

  it('declares reads as read and apply/revert as write', () => {
    const { actions } = createHarness()
    expect(actions.get(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT)).toBe('read')
    expect(actions.get(RPC_CHANNELS.memory.REPO_APPLY_IMPORT)).toBe('write')
    expect(actions.get(RPC_CHANNELS.memory.REPO_REVERT_IMPORT)).toBe('write')
  })

  it('rejects a cross-workspace bank id before touching the runtime', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1' }, 'ws:other'),
    ).rejects.toThrow('Workspace access denied')
  })

  it('rejects an unknown bank', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1'),
    ).rejects.toThrow('Memory repo bank not found')
  })

  it('a principal cannot import a foreign owner suffix or the main bank', async () => {
    const { invoke } = createHarness()
    const foreign = ownerKey8For({ issuer: 'native', subject: 'someone-else' })
    const principal = { issuer: 'native', subject: 'agent', credentialId: 'c', credentialVersion: 1 }
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1', principal }, `ws:ws1#${foreign}`),
    ).rejects.toThrow('Memory bank access denied')
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1', principal }, 'main'),
    ).rejects.toThrow('Memory bank access denied')
    // Its own owner suffix passes authorization (and then fails on the missing runtime, not on the bank).
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1', principal }, `ws:ws1#${ownerKey8For({ issuer: 'native', subject: 'agent' })}`),
    ).rejects.toThrow('Memory repo bank not found')
  })

  it('a local caller cannot import a concrete owner suffix', async () => {
    const { invoke } = createHarness()
    const foreign = ownerKey8For({ issuer: 'native', subject: 'someone-else' })
    await expect(
      invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1' }, `ws:ws1#${foreign}`),
    ).rejects.toThrow('Memory bank access denied')
  })
})

describe('preview', () => {
  it('returns edits with a conflict count and links existing proposals', async () => {
    const rule = 'Always run the full checks'
    runtime = makeRuntime({
      files: [{ path: 'lessons/workflow/a--id1.md', content: lessonFileContent('id1', rule, repoRuleHash('Always run checks')) }],
      known: [{ path: 'lessons/workflow/a--id1.md', lessonId: 'id1', ruleHash: repoRuleHash('Always run checks'), rule: 'Always run checks', disabled: false, baseHash: repoRuleHash('Always run checks') }],
    })
    const { invoke } = createHarness()
    const preview = await invoke(RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1') as {
      edits: Array<{ kind: string; path: string; diff?: string; proposalId?: string }>
      conflicts: number
    }
    expect(preview.edits).toHaveLength(1)
    expect(preview.edits[0]!.kind).toBe('update')
    expect(preview.conflicts).toBe(0)
    expect(preview.edits[0]!.proposalId).toBeUndefined()
  })
})

describe('apply', () => {
  function conflictRuntime(): MemoryRepoImportRuntime {
    return makeRuntime({
      files: [{ path: 'lessons/workflow/a--id1.md', content: lessonFileContent('id1', 'New rule', 'fileHash') }],
      known: [{ path: 'lessons/workflow/a--id1.md', lessonId: 'id1', ruleHash: repoRuleHash('Old rule'), rule: 'Old rule', disabled: false, baseHash: 'storedHash' }],
    })
  }

  it('creates one proposal per edit and is idempotent on repeat', async () => {
    runtime = makeRuntime({
      files: [{ path: 'lessons/workflow/a--id1.md', content: lessonFileContent('id1', 'A new rule') }],
      known: [],
    })
    const { invoke } = createHarness()
    const first = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1') as { added: number; proposalIds: string[] }
    expect(first.added).toBe(1)
    const second = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1') as { added: number }
    expect(second.added).toBe(0)
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(1)
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).get(first.proposalIds[0]!)?.kind).toBe('rule')
  })

  it('S1: a padded / implicit-local id addresses the canonical bank and its proposal store', async () => {
    runtime = makeRuntime({
      files: [{ path: 'lessons/workflow/a--id1.md', content: lessonFileContent('id1', 'A new rule') }],
      known: [],
    })
    const { invoke } = createHarness()
    const first = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, '  ws:ws1#local  ') as { added: number; proposalIds: string[] }
    expect(first.added).toBe(1)
    // The canonical spelling hits the SAME proposal store → the idempotent apply adds nothing.
    const second = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1') as { added: number }
    expect(second.added).toBe(0)
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(1)
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).get(first.proposalIds[0]!)?.id).toBe(first.proposalIds[0])
  })

  it('skips a rule-changed conflict without override and reports it', async () => {
    runtime = conflictRuntime()
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1') as { added: number; skipped: Array<{ path: string; conflict: string }> }
    expect(result.added).toBe(0)
    expect(result.skipped).toEqual([{ path: 'lessons/workflow/a--id1.md', conflict: 'rule-changed' }])
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(0)
  })

  it('creates the proposal when override is set', async () => {
    runtime = conflictRuntime()
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.memory.REPO_APPLY_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { override: true }) as { added: number }
    expect(result.added).toBe(1)
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(1)
  })
})

describe('revert', () => {
  it('disables the lesson and records exactly one disable/archive proposal', async () => {
    const rule = 'Always keep the changelog current'
    const store = new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace')
    store.add({ ts: '2026-01-01T00:00:00.000Z', rule, category: 'workflow', scope: 'workspace', source: { trigger: 'explicit' } })
    runtime = makeRuntime({ known: [{ path: 'lessons/workflow/c--id3.md', lessonId: 'id3', ruleHash: repoRuleHash(rule), rule, disabled: false }] })

    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { lessonId: 'id3' }) as {
      proposal: { riskFlags: string[] }
      disabled: boolean
    }
    expect(result.disabled).toBe(true)
    expect(result.proposal.riskFlags).toEqual(expect.arrayContaining(['repo-revert', 'disable', 'archive']))

    const proposals = new MemoryProposalStore(join(workspaceRoot, 'memory')).list()
    expect(proposals).toHaveLength(1)

    const disabled = store.list().find((lesson) => lesson.rule === rule)
    expect(disabled?.disabled).toBe(true)

    await invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { lessonId: 'id3' })
    expect(new MemoryProposalStore(join(workspaceRoot, 'memory')).list()).toHaveLength(1)
  })

  it('rejects when no target can be resolved', async () => {
    runtime = makeRuntime({ known: [] })
    const { invoke } = createHarness()
    await expect(invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { lessonId: 'missing' }))
      .rejects.toThrow('Memory repo revert target not found')
  })

  it('notifies the exact bank that was written and still writes with no notifier', async () => {
    const rule = 'Always keep the changelog current'
    const store = new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace')
    store.add({ ts: '2026-01-01T00:00:00.000Z', rule, category: 'workflow', scope: 'workspace', source: { trigger: 'explicit' } })
    runtime = makeRuntime({ known: [{ path: 'lessons/workflow/c--id3.md', lessonId: 'id3', ruleHash: repoRuleHash(rule), rule, disabled: false }] })

    const notifications: Array<{ bank: unknown; reason: string }> = []
    setRepoNotifier((bank, reason) => notifications.push({ bank, reason }))
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { lessonId: 'id3' }) as { disabled: boolean }

    expect(result.disabled).toBe(true)
    expect(store.list().find((lesson) => lesson.rule === rule)?.disabled).toBe(true)
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'repoRevertImport' },
    ])

    // The main bank maps to `{ scope: 'main' }`.
    const mainRule = 'Global rule disabled from the repo'
    const globalStore = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
    globalStore.add({ ts: '2026-01-01T00:00:00.000Z', rule: mainRule, category: 'workflow', scope: 'global', source: { trigger: 'explicit' } })
    runtime = makeRuntime({
      bankId: 'main',
      scope: 'main',
      workspaceId: null,
      workspaceRoot: undefined,
      known: [{ path: 'lessons/workflow/g--id9.md', lessonId: 'id9', ruleHash: repoRuleHash(mainRule), rule: mainRule, disabled: false }],
    })
    notifications.length = 0
    await invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: null }, 'main', { lessonId: 'id9' })
    expect(notifications).toEqual([{ bank: { scope: 'main' }, reason: 'repoRevertImport' }])

    // No notifier registered: the update path still succeeds.
    setRepoNotifier(null)
    const quietRule = 'Quiet rule reverted'
    store.add({ ts: '2026-01-01T00:00:00.000Z', rule: quietRule, category: 'workflow', scope: 'workspace', source: { trigger: 'explicit' } })
    runtime = makeRuntime({ known: [{ path: 'lessons/workflow/q--idq.md', lessonId: 'idq', ruleHash: repoRuleHash(quietRule), rule: quietRule, disabled: false }] })
    const quiet = await invoke(RPC_CHANNELS.memory.REPO_REVERT_IMPORT, { workspaceId: 'ws1' }, 'ws:ws1', { lessonId: 'idq' }) as { disabled: boolean }
    expect(quiet.disabled).toBe(true)
  })
})