/**
 * Wave-A repo-notify seam tests (A4).
 *
 * Every lesson/context/preference write must call `notifyRepoMutation(bank,
 * reason)` exactly once: the distill `applyResult` path, the RPC mutation
 * handlers, the import path, a durable proposal approval, and the promotion
 * engine's promotion/rollback. The seam itself is a no-op without a registered
 * notifier and swallows a throwing notifier (it must never break a write).
 * `setDistiller` negotiates the widened `string | {text,usage}` result and the
 * two authorization helpers stay importable and behavior-identical.
 *
 * Harness mirrors memory-io.test.ts: CRAFT_CONFIG_DIR is redirected by
 * memory-test-setup, the workspace registry is mocked.
 */
import '../../handlers/rpc/memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handlers/handler-deps'
import type { Lesson } from '@rox/shared/memory/types'
import type { LearningCandidate } from '@rox/shared/memory/learning'
import type { MemoryProposal } from '@rox/shared/memory/proposals'

let workspaceRoots: string[]
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@rox/shared/config', () => ({
  resolveConfigDir: () => configDir,
  getWorkspaceByNameOrId: (id: string) => {
    const i = ['ws1', 'ws2'].indexOf(id)
    return i >= 0 ? { id, name: id, rootPath: workspaceRoots[i] } : null
  },
  getWorkspaces: () => ['ws1', 'ws2'].map((id, i) => ({ id, name: id, rootPath: workspaceRoots[i] })),
}))

import { notifyRepoMutation, setRepoNotifier } from '../repo/notify'
import { MemoryService, type SessionCompletionLike } from '../MemoryService'
import { LessonStore } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { MemoryProposalStore } from '../MemoryProposalStore'
import { approveMemoryProposalDurably } from '../approve-memory-proposal'
import { ownerKey8For } from '../repo/RepoSourceProvider'
import { authorizeMemoryWorkspace, lessonOwnerFromContext, registerMemoryHandlers } from '../../handlers/rpc/memory'
import { registerMemoryIoHandlers, type MemoryExportBundle } from '../../handlers/rpc/memory-io'
import { PromotionEngine } from '../learning/PromotionEngine'
import { CandidateStore } from '../learning/CandidateStore'
import { EvidenceStore } from '../learning/EvidenceStore'
import { MutationStore } from '../learning/MutationStore'
import { LearningAudit } from '../learning/LearningAudit'
import type { LearningTargetStores } from '../learning/learning-types'

// ---------------------------------------------------------------------------
// Notifier recorder / shared fixtures
// ---------------------------------------------------------------------------

interface RecordedNotify {
  bank: unknown
  reason: string
}
let notifications: RecordedNotify[] = []

function installNotifier(): void {
  notifications = []
  setRepoNotifier((bank, reason) => {
    notifications.push({ bank, reason })
  })
}

beforeEach(() => {
  workspaceRoots = [0, 1].map(() => mkdtempSync(join(tmpdir(), 'mem-notify-ws-')))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
  notifications = []
})

afterEach(() => {
  setRepoNotifier(null)
  for (const root of workspaceRoots) rmSync(root, { recursive: true, force: true })
})

function rpcHarness(register: (server: RpcServer, deps: HandlerDeps) => void) {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
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
  register(server, deps)
  const invokeAs = (ctx: RequestContext, channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler(ctx, ...args)
  }
  const invoke = (channel: string, ...args: unknown[]) =>
    invokeAs({ clientId: 'c1', workspaceId: null, webContentsId: null } as RequestContext, channel, ...args)
  return { invoke, invokeAs }
}

function lesson(rule: string, scope: 'global' | 'workspace' = 'workspace'): Lesson {
  return { ts: '2026-01-01T00:00:00.000Z', rule, category: 'workflow', scope, source: { trigger: 'explicit' } }
}

// ---------------------------------------------------------------------------
// 1. The seam: no-op without a notifier, swallows a throwing notifier
// ---------------------------------------------------------------------------

describe('notifyRepoMutation seam', () => {
  it('is a no-op when no notifier is registered', () => {
    setRepoNotifier(null)
    expect(() => notifyRepoMutation({ scope: 'main' }, 'x')).not.toThrow()
    expect(() => notifyRepoMutation({ scope: 'workspace', workspaceId: 'ws1' }, 'x')).not.toThrow()
  })

  it('swallows a throwing notifier and never breaks the caller', () => {
    setRepoNotifier(() => {
      throw new Error('notifier boom')
    })
    expect(() => notifyRepoMutation({ scope: 'main' }, 'x')).not.toThrow()
  })

  it('forwards bank + reason to the registered notifier', () => {
    installNotifier()
    notifyRepoMutation({ scope: 'workspace', workspaceId: 'ws1' }, 'rpc:addLesson')
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'rpc:addLesson' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. RPC lesson add emits exactly one notify with the right bank ref
// ---------------------------------------------------------------------------

describe('RPC memory mutations notify', () => {
  it('ADD_LESSON emits exactly one notify with the workspace bank ref', async () => {
    installNotifier()
    const { invoke } = rpcHarness(registerMemoryHandlers)
    await invoke(RPC_CHANNELS.memory.ADD_LESSON, 'ws1', {
      rule: 'run tests before shipping',
      category: 'workflow',
      scope: 'workspace',
    })
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'rpc:addLesson' },
    ])
  })

  it('UPDATE_LESSON emits exactly one notify when a lesson changed', async () => {
    installNotifier()
    const { invoke } = rpcHarness(registerMemoryHandlers)
    await invoke(RPC_CHANNELS.memory.ADD_LESSON, 'ws1', { rule: 'old rule', category: 'workflow', scope: 'workspace' })
    notifications = []
    await invoke(RPC_CHANNELS.memory.UPDATE_LESSON, 'ws1', 'workspace', 'old rule', { rule: 'new rule' })
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'rpc:updateLesson' },
    ])
  })

  it('a principal-owned lesson write notifies the owner-scoped workspace bank (S2)', async () => {
    installNotifier()
    const { invokeAs } = rpcHarness(registerMemoryHandlers)
    const owner = { issuer: 'native', subject: 'agent' }
    await invokeAs(
      { clientId: 'native-1', workspaceId: 'ws1', webContentsId: null, principal: { ...owner, credentialId: 'c', credentialVersion: 1 } } as RequestContext,
      RPC_CHANNELS.memory.ADD_LESSON,
      'ws1',
      { rule: 'owner-scoped rule', category: 'workflow', scope: 'workspace' },
    )
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1', ownerKey8: ownerKey8For(owner) }, reason: 'rpc:addLesson' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 3. Import emits once for the whole batch
// ---------------------------------------------------------------------------

describe('memory import notifies', () => {
  it('emits exactly one notify for a multi-lesson global import batch', async () => {
    installNotifier()
    const { invoke } = rpcHarness(registerMemoryIoHandlers)
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [lesson('a', 'global'), lesson('b', 'global'), lesson('c', 'global')],
      context: '',
      preferences: '',
      history: [],
    }
    await invoke(RPC_CHANNELS.memory.IMPORT, 'global', null, bundle)
    expect(notifications).toEqual([{ bank: { scope: 'main' }, reason: 'import' }])
  })

  it('workspace import that rewrote global preferences notifies the workspace bank AND main', async () => {
    installNotifier()
    const { invoke } = rpcHarness(registerMemoryIoHandlers)
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [lesson('a', 'workspace')],
      context: '',
      preferences: 'Prefer concise answers',
      history: [],
    }
    await invoke(RPC_CHANNELS.memory.IMPORT, 'workspace', 'ws1', bundle)
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'import' },
      { bank: { scope: 'main' }, reason: 'import:preferences' },
    ])
    // Without a registered notifier the import still lands (seam is advisory).
    setRepoNotifier(null)
    const result = await invoke(RPC_CHANNELS.memory.IMPORT, 'workspace', 'ws1', {
      ...bundle,
      lessons: [lesson('b', 'workspace')],
    })
    expect(result).toMatchObject({ added: 1 })
  })

  it('a principal-owned workspace import notifies the owner-scoped bank in addition to the base (S2)', async () => {
    installNotifier()
    const { invokeAs } = rpcHarness(registerMemoryIoHandlers)
    const owner = { issuer: 'native', subject: 'agent' }
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [lesson('a', 'workspace')],
      context: '',
      preferences: '',
      history: [],
    }
    await invokeAs(
      { clientId: 'native-1', workspaceId: 'ws1', webContentsId: null, principal: { ...owner, credentialId: 'c', credentialVersion: 1 } } as RequestContext,
      RPC_CHANNELS.memory.IMPORT,
      'workspace',
      'ws1',
      bundle,
    )
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'import' },
      { bank: { scope: 'workspace', workspaceId: 'ws1', ownerKey8: ownerKey8For(owner) }, reason: 'import' },
    ])
  })

  it('a principal-owned global import notifies the owner-scoped main bank in addition to the base (S2)', async () => {
    installNotifier()
    const { invokeAs } = rpcHarness(registerMemoryIoHandlers)
    const owner = { issuer: 'native', subject: 'agent' }
    const bundle: MemoryExportBundle = {
      version: 1,
      lessons: [lesson('a', 'global')],
      context: '',
      preferences: '',
      history: [],
    }
    await invokeAs(
      { clientId: 'native-1', workspaceId: 'ws1', webContentsId: null, principal: { ...owner, credentialId: 'c', credentialVersion: 1 } } as RequestContext,
      RPC_CHANNELS.memory.IMPORT,
      'global',
      null,
      bundle,
    )
    expect(notifications).toEqual([
      { bank: { scope: 'main' }, reason: 'import' },
      { bank: { scope: 'main', ownerKey8: ownerKey8For(owner) }, reason: 'import' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 4. Durable proposal approval emits once
// ---------------------------------------------------------------------------

describe('proposal approval notifies', () => {
  it('emits exactly one notify after a durable global approval', () => {
    const workspaceRoot = workspaceRoots[0]!
    const store = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    const proposal: MemoryProposal = {
      id: 'mp_notify',
      text: 'Always preserve the current document',
      kind: 'rule',
      status: 'pending',
      sessionId: 'sess1',
      workspaceId: 'ws1',
      sourceMessageIds: ['m1'],
      provenance: { trigger: 'brain' },
      riskFlags: [],
      conflicts: [],
      editHistory: [],
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
      cost: { tokens: 10, model: 'rox/fast' },
    }
    store.save(proposal)
    installNotifier()
    const result = approveMemoryProposalDurably({ store, workspaceRoot, proposalId: proposal.id, scope: 'global' })
    expect(result?.status).toBe('approved_global')
    expect(notifications).toEqual([{ bank: { scope: 'main' }, reason: 'proposal-approve' }])
  })

  it('a personal approval writes the global lessons file and notifies main#owner8 (S2)', () => {
    const workspaceRoot = workspaceRoots[0]!
    const owner = { issuer: 'native', subject: 'agent' }
    const store = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    const proposal: MemoryProposal = {
      id: 'mp_personal',
      text: 'Always keep personal notes private',
      kind: 'rule',
      status: 'pending',
      sessionId: 'sess1',
      workspaceId: 'ws1',
      sourceMessageIds: ['m1'],
      provenance: { trigger: 'brain' },
      riskFlags: [],
      conflicts: [],
      editHistory: [],
      owner,
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
      cost: { tokens: 10, model: 'rox/fast' },
    }
    store.save(proposal)
    installNotifier()
    const result = approveMemoryProposalDurably({ store, workspaceRoot, proposalId: proposal.id, scope: 'personal', owner })
    expect(result?.status).toBe('approved_personal')
    expect(notifications).toEqual([
      { bank: { scope: 'main', ownerKey8: ownerKey8For(owner) }, reason: 'proposal-approve' },
    ])
  })

  it('a workspace approval with an owner notifies the owner-scoped workspace bank (S2)', () => {
    const workspaceRoot = workspaceRoots[0]!
    const owner = { issuer: 'native', subject: 'agent' }
    const store = new MemoryProposalStore(join(workspaceRoot, 'memory'))
    const proposal: MemoryProposal = {
      id: 'mp_ws_owner',
      text: 'Always run the workspace checks',
      kind: 'rule',
      status: 'pending',
      sessionId: 'sess1',
      workspaceId: 'ws1',
      sourceMessageIds: ['m1'],
      provenance: { trigger: 'brain' },
      riskFlags: [],
      conflicts: [],
      editHistory: [],
      owner,
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
      cost: { tokens: 10, model: 'rox/fast' },
    }
    store.save(proposal)
    installNotifier()
    const result = approveMemoryProposalDurably({ store, workspaceRoot, proposalId: proposal.id, scope: 'workspace', owner })
    expect(result?.status).toBe('approved_workspace')
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1', ownerKey8: ownerKey8For(owner) }, reason: 'proposal-approve' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 5. Promotion engine: promotion and rollback each notify once
// ---------------------------------------------------------------------------

describe('promotion engine notifies', () => {
  const NOW = Date.parse('2026-10-08T00:00:00.000Z')
  const NOW_ISO = new Date(NOW).toISOString()
  const RULE = 'run tests before committing'

  function makeTargets(): LearningTargetStores {
    return {
      addLesson: () => {},
      removeLesson: () => true,
      enqueueSkill: () => true,
      removeQueuedSkill: () => true,
      readQueuedSkill: () => null,
      savePolicy: () => {},
      removePolicy: () => true,
    } as LearningTargetStores
  }

  function makeCandidate(over: Partial<LearningCandidate> = {}): LearningCandidate {
    return {
      id: 'cand_notify',
      fingerprint: 'a'.repeat(64),
      type: 'lesson',
      scope: 'workspace',
      hypothesis: RULE,
      payload: { rule: RULE, category: 'workflow' },
      evidence: [{ evidenceId: 'ev_1', type: 'successful_outcome', ref: 'task-1', weight: 1 }],
      confidence: 0.9,
      confidenceComponents: {
        recurrence: 0.9,
        evidenceQuality: 0.9,
        userSignal: 0.9,
        repositorySupport: 0.9,
        outcomeSupport: 0.9,
        consistency: 0.9,
      },
      status: 'approved',
      validation: { passes: [{ pass: 'evidence_count', ok: true }], promotable: true, checkedAt: NOW_ISO },
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      ...over,
    }
  }

  function makeEngine(dir: string, candidateStore: CandidateStore): PromotionEngine {
    return new PromotionEngine({
      targets: makeTargets(),
      mutationStore: new MutationStore(dir),
      candidateStore,
      evidenceStore: new EvidenceStore(dir),
      audit: new LearningAudit(dir),
      clock: () => NOW,
      // Same wiring as LearningService: repo notify rides the existing emit dep.
      emit: (evt) => notifyRepoMutation({ scope: 'workspace', workspaceId: evt.workspaceId }, evt.kind),
    })
  }

  it('emits exactly one notify with reason promotion', async () => {
    installNotifier()
    const dir = workspaceRoots[0]!
    const candidateStore = new CandidateStore(dir)
    candidateStore.save(makeCandidate())
    const engine = makeEngine(dir, candidateStore)
    const result = await engine.promote(makeCandidate(), { approval: 'autonomous', workspaceId: 'ws1' })
    expect(result.promoted).toBe(true)
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'promotion' },
    ])
  })

  it('emits exactly one notify with reason rollback when a promotion reverts', async () => {
    installNotifier()
    const dir = workspaceRoots[0]!
    const real = new CandidateStore(dir)
    const brokenCandidateStore = {
      get: (id: string) => real.get(id),
      save: () => {
        throw new Error('candidate store disk full')
      },
    } as unknown as CandidateStore
    const engine = makeEngine(dir, brokenCandidateStore)
    const result = await engine.promote(makeCandidate(), { approval: 'autonomous', workspaceId: 'ws1' })
    expect(result.promoted).toBe(false)
    expect(notifications).toEqual([
      { bank: { scope: 'workspace', workspaceId: 'ws1' }, reason: 'rollback' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 6. applyResult emits once; setDistiller negotiates both shapes
// ---------------------------------------------------------------------------

const MSGS = [
  { id: 'm1', type: 'user', content: 'hello' },
  { id: 'm2', type: 'assistant', content: 'done' },
] as never

const OK_RESULT = {
  history_entry: 'Session wrapped up',
  memory_update: null,
  lessons: [{ rule: 'Run tests before shipping', category: 'workflow' }],
  skill_candidate: null,
}

function makeService(distiller: (prompt: string, sessionId?: string) => Promise<unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'mem-notify-svc-'))
  const wsFiles = new MemoryFileStore('workspace', root)
  const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
  const svc = new MemoryService({
    workspaceRoot: root,
    workspaceId: 'ws-1',
    lessonStoreFactory: () => wsLessons,
    fileStore: wsFiles,
    skillQueue: { enqueue: () => true } as never,
    distiller: distiller as never,
    emit: () => {},
    logger: { warn: () => {} },
    readMessages: () => MSGS,
    getConfig: () => ({
      enabled: true,
      distillIdleHours: 3,
      distillMsgCount: 1,
      negativeFirst: true,
      redactExtraPatterns: [],
      ftsLimit: 20,
      semantic: false,
      dreamIntervalHours: 4,
      dreamNotes: true,
    }),
  })
  let fire: ((evt: SessionCompletionLike) => void) | null = null
  svc.attachSessionCompletion((cb) => {
    fire = cb
    return () => {}
  })
  return { svc, wsLessons, root, complete: () => fire!({ sessionId: 's1', reason: 'complete' }) }
}

async function drain(svc: MemoryService): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await svc.whenIdle()
}

describe('MemoryService distill seam', () => {
  it('applyResult emits exactly one notify with reason distill', async () => {
    installNotifier()
    const h = makeService(async () => JSON.stringify(OK_RESULT))
    try {
      h.complete()
      await drain(h.svc)
      expect(h.wsLessons.list()).toHaveLength(1)
      expect(notifications).toEqual([
        { bank: { scope: 'workspace', workspaceId: 'ws-1' }, reason: 'distill' },
      ])
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('setDistiller accepts a {text,usage} result and records the usage', async () => {
    const h = makeService(async () => {
      throw new Error('no distiller')
    })
    try {
      h.svc.setDistiller(async () => ({
        text: JSON.stringify(OK_RESULT),
        usage: { inputTokens: 12, outputTokens: 4 },
      }))
      h.complete()
      await drain(h.svc)
      expect(h.wsLessons.list()).toHaveLength(1)
      expect(h.svc.getLastDistillerUsage()).toEqual({ inputTokens: 12, outputTokens: 4 })
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('setDistiller keeps the string shape working and reports no usage', async () => {
    const h = makeService(async () => JSON.stringify(OK_RESULT))
    try {
      h.svc.setDistiller(async () => JSON.stringify(OK_RESULT))
      h.complete()
      await drain(h.svc)
      expect(h.wsLessons.list()).toHaveLength(1)
      expect(h.svc.getLastDistillerUsage()).toBeNull()
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Authorization helpers stay importable and behavior-identical
// ---------------------------------------------------------------------------

describe('memory authorization helpers', () => {
  it('lessonOwnerFromContext mirrors the transport principal', () => {
    const principal = { issuer: 'iss', subject: 'sub' }
    expect(lessonOwnerFromContext({ principal } as RequestContext)).toEqual({ issuer: 'iss', subject: 'sub' })
    expect(lessonOwnerFromContext({} as RequestContext)).toBeUndefined()
  })

  it('authorizeMemoryWorkspace accepts the bound workspace and rejects a mismatch', () => {
    const deps = {} as HandlerDeps
    expect(authorizeMemoryWorkspace({ workspaceId: 'ws1' } as RequestContext, 'ws1', deps)).toBe('ws1')
    expect(() =>
      authorizeMemoryWorkspace({ workspaceId: 'ws1' } as RequestContext, 'ws2', deps),
    ).toThrow('Workspace access denied')
    expect(authorizeMemoryWorkspace({ webContentsId: null } as RequestContext, 'ws2', deps)).toBe('ws2')
  })
})