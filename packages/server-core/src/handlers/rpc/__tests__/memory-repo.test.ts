/**
 * `memory:repo*` + `memory:dream*` RPC tests (Wave A, WP-03).
 *
 * Mirrors learning.test.ts: config dir is redirected by memory-test-setup before
 * any module reads it, the repo service / dream scheduler are call-recording
 * stubs, and no bank is materialized. The stub runtime is injected through the
 * additive third argument so no git/service bootstrap runs.
 */
import '../memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { resolveConfigDir } from '@rox/shared/config/paths'
import type {
  MemoryDreamEvent,
  MemoryRepoBankInfo,
  MemoryRepoCommit,
  MemoryRepoCommitFile,
  MemoryRepoStatus,
} from '@rox/shared/memory/repo'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import { MemoryRepoService } from '../../../memory/repo/MemoryRepoService'
import type { DreamScheduler } from '../../../memory/repo/DreamScheduler'
import type { HandlerDeps } from '../../handler-deps'
import {
  DREAM_LOG_TAIL_BYTES,
  HANDLED_CHANNELS,
  readDreamLog,
  registerMemoryRepoHandlers,
  wireRepoImportReady,
  type MemoryRepoRuntime,
} from '../memory-repo'
import { HANDLED_CHANNELS as IMPORT_HANDLED_CHANNELS } from '../memory-repo-import'
import { ownerKey8For, type RepoSourceProvider } from '../../../memory/repo/RepoSourceProvider'

const CH = RPC_CHANNELS.memory

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const unavailableGit = {
  available: async () => false,
  run: async () => ({ ok: false, stdout: '', stderr: 'git unavailable', code: null }),
}

const READ_CHANNELS = [
  CH.REPO_LIST_BANKS,
  CH.REPO_STATUS,
  CH.REPO_TREE,
  CH.REPO_READ_FILE,
  CH.REPO_COMMITS,
  CH.REPO_COMMIT_DIFF,
  CH.REPO_GRAPH,
  CH.DREAM_STATUS,
  CH.DREAM_LOG,
] as const

const WRITE_CHANNELS = [CH.REPO_EXPORT, CH.DREAM_RUN] as const

function statusStub(bankId: string) {
  return {
    bankId,
    scope: 'main' as const,
    repoPath: '/tmp/repo',
    mode: 'snapshots' as const,
    head: null,
    lastMaterializeAt: null,
    dirty: false,
    editedFiles: [],
    foreignTree: false,
    pendingImportCount: 0,
    dream: { lastRunAt: null, nextRunAt: null, intervalHours: 4, costTodayUsd: 0, costIsEstimate: true },
  }
}

function createRuntime(recorded: string[], banks: MemoryRepoBankInfo[] = []): MemoryRepoRuntime {
  const service = {
    listBanks: async () => banks,
    status: async (bankId: string) => {
      recorded.push(`status:${bankId}`)
      return statusStub(bankId)
    },
    tree: async () => [],
    readFile: async (_bankId: string, path: string) => ({ path, content: '', truncated: false, edited: false }),
    listCommits: async () => [],
    commitDiff: async () => [],
    graph: async () => ({ nodes: [], edges: [] }),
    exportZip: async (bankId: string) => {
      recorded.push(`export:${bankId}`)
      return { path: `/tmp/${bankId}.zip`, bytes: 0 }
    },
    writeRepoFile: async () => {},
    materialize: async () => ({ committed: false, files: 0, edited: [] }),
    ensureMaterialized: async () => null,
    notifyMutation: () => {},
    dreamBankIds: async () => ['main'],
    dispose: async () => {},
    repoPathFor: () => '',
  } as unknown as MemoryRepoService

  const scheduler = {
    start: () => {},
    stop: () => {},
    runNow: async (bankId: string, opts?: { noteIds?: string[] }) => {
      const forced = opts?.noteIds?.length ? `|${opts.noteIds.join(',')}` : ''
      recorded.push(`run:${bankId}${forced}`)
      return {
        dreamId: 'dream-1',
        bankId,
        startedAt: '2026-10-09T00:00:00.000Z',
        endedAt: '2026-10-09T00:00:01.000Z',
        status: 'ok' as const,
        costUsd: 0,
        costIsEstimate: true,
      }
    },
    status: async (bankId: string) => ({
      bankId,
      running: false,
      lastRun: null,
      nextRunAt: null,
      intervalHours: 4,
      costTodayUsd: 0,
      costIsEstimate: true,
      pendingNoteIds: [],
    }),
    onEvent: () => () => {},
  } as unknown as DreamScheduler

  return { service, scheduler }
}

function createHarness(runtime?: MemoryRepoRuntime, banks?: MemoryRepoBankInfo[]) {
  const recorded: string[] = []
  const handlers: Record<string, HandlerFn | undefined> = {}
  const options: Record<string, RpcHandlerOptions | undefined> = {}
  const server: RpcServer = {
    handle(channel, handler, handlerOptions) {
      handlers[channel] = handler
      if (handlerOptions) options[channel] = handlerOptions
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
    isRequestContextCurrent: () => true,
  }
  const deps: HandlerDeps = {
    sessionManager: { getWorkspaces: () => [] } as unknown as HandlerDeps['sessionManager'],
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
  registerMemoryRepoHandlers(server, deps, runtime ?? createRuntime(recorded, banks))
  const invoke = (ctx: RequestContext, channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return handler(ctx, ...args)
  }
  return { recorded, options, handlers, invoke }
}

/** Local Electron client: workspace bound by the window, no principal. */
function localContext(workspaceId = 'ws1'): RequestContext {
  return { clientId: 'c1', workspaceId, webContentsId: null }
}

/** Native principal (agent runtime) with no window binding. */
function nativeContext(workspaceId: string | null = null): RequestContext {
  return {
    clientId: 'native-1',
    workspaceId,
    webContentsId: null,
    principal: { issuer: 'native', subject: 'agent', credentialId: 'cred-1', credentialVersion: 1 },
  }
}

async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('memory:repo* / memory:dream* registration', () => {
  it('registers every handled channel and nothing else', () => {
    const harness = createHarness()
    expect(HANDLED_CHANNELS).toHaveLength(11)
    const expected = [...HANDLED_CHANNELS, ...IMPORT_HANDLED_CHANNELS].sort()
    expect(Object.keys(harness.handlers).sort()).toEqual(expected)
  })

  it('declares nativeAction read for reads and write for dreamRun/export', () => {
    const harness = createHarness()
    for (const channel of HANDLED_CHANNELS) {
      expect(harness.options[channel]?.nativeAction).toBeDefined()
    }
    for (const channel of READ_CHANNELS) {
      expect(harness.options[channel]).toEqual({ nativeAction: 'read' })
    }
    for (const channel of WRITE_CHANNELS) {
      expect(harness.options[channel]).toEqual({ nativeAction: 'write' })
    }
  })

  it('never takes workspaceId from the payload — rejects cross-workspace bank ids', async () => {
    const harness = createHarness()
    const message = await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_STATUS, 'ws:ws2'))
    expect(message).toBe('Workspace access denied')
    // Same rejection for every bank-scoped read.
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_TREE, 'ws:ws2'))).toBe('Workspace access denied')
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.DREAM_STATUS, 'ws:ws2'))).toBe('Workspace access denied')
  })

  it('rejects malformed bank ids', async () => {
    const harness = createHarness()
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_STATUS, 'not-a-bank'))).toBeDefined()
  })

  it('denies an unbound native principal', async () => {
    const harness = createHarness()
    expect(await rejection(() => harness.invoke(nativeContext(null), CH.REPO_LIST_BANKS))).toBe('Workspace access denied')
  })

  it('dreamRun delegates to the scheduler and returns the run (no handler-side push)', async () => {
    const harness = createHarness()
    const run = (await harness.invoke(localContext('ws1'), CH.DREAM_RUN, 'main')) as { dreamId: string; bankId: string; status: string }
    expect(run.dreamId).toBe('dream-1')
    expect(run.bankId).toBe('main')
    expect(run.status).toBe('ok')
    expect(harness.recorded).toContain('run:main')
  })

  it('repoExport delegates to the service', async () => {
    const harness = createHarness()
    const result = (await harness.invoke(localContext('ws1'), CH.REPO_EXPORT, 'main')) as { path: string; bytes: number }
    expect(result.path).toBe('/tmp/main.zip')
    expect(result.bytes).toBe(0)
  })

  it('dreamLog on an unmaterialized bank is empty', async () => {
    const harness = createHarness()
    expect(await harness.invoke(localContext('ws1'), CH.DREAM_LOG, 'main')).toEqual([])
  })
})

describe('bank owner binding (memory:repo* / memory:dream*)', () => {
  const OWN_KEY = ownerKey8For({ issuer: 'native', subject: 'agent' })
  const FOREIGN_KEY = ownerKey8For({ issuer: 'native', subject: 'someone-else' })

  it('a principal cannot read a foreign owner suffix (graph, readFile, dreamRun)', async () => {
    const harness = createHarness()
    const bank = `ws:ws1#${FOREIGN_KEY}`
    expect(FOREIGN_KEY).not.toBe(OWN_KEY)
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, bank))).toBe('Memory bank access denied')
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.REPO_READ_FILE, bank, 'MEMORY.md'))).toBe('Memory bank access denied')
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.DREAM_RUN, bank))).toBe('Memory bank access denied')
    expect(harness.recorded).not.toContain(`run:${bank}`)
  })

  it('a principal may read its own workspace bank ownerless or with its own owner key', async () => {
    const harness = createHarness()
    await harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, 'ws:ws1')
    await harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, `ws:ws1#${OWN_KEY}`)
    // Cross-workspace rejection is unchanged.
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, 'ws:ws2'))).toBe('Workspace access denied')
  })

  it('a principal is denied the main bank entirely', async () => {
    const harness = createHarness()
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, 'main'))).toBe('Memory bank access denied')
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.REPO_GRAPH, `main#${OWN_KEY}`))).toBe('Memory bank access denied')
    expect(await rejection(() => harness.invoke(nativeContext('ws1'), CH.DREAM_RUN, 'main'))).toBe('Memory bank access denied')
  })

  it('a local caller cannot use a concrete owner suffix but keeps main and ws banks', async () => {
    const harness = createHarness()
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_GRAPH, `ws:ws1#${FOREIGN_KEY}`))).toBe('Memory bank access denied')
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_TREE, `main#${OWN_KEY}`))).toBe('Memory bank access denied')
    // Ownerless banks (absent or `local`) still work.
    await harness.invoke(localContext('ws1'), CH.REPO_GRAPH, 'main')
    await harness.invoke(localContext('ws1'), CH.REPO_GRAPH, 'ws:ws1')
    await harness.invoke(localContext('ws1'), CH.REPO_GRAPH, 'ws:ws1#local')
  })
})

describe('repoListBanks scoping (D5)', () => {
  const BANK_FIXTURE: MemoryRepoBankInfo[] = [
    { id: 'main', scope: 'main', label: 'main', repoPath: '/r/main', isMain: true },
    { id: 'ws:ws1', scope: 'workspace', label: 'One', repoPath: '/r/one', isMain: false },
    { id: 'ws:ws2', scope: 'workspace', label: 'Two', repoPath: '/r/two', isMain: false },
  ]

  it('a principal sees only its own workspace bank; a local caller sees every bank', async () => {
    const local = createHarness(undefined, BANK_FIXTURE)
    expect(await local.invoke(localContext('ws1'), CH.REPO_LIST_BANKS)).toEqual(BANK_FIXTURE)

    const principal = createHarness(undefined, BANK_FIXTURE)
    expect(await principal.invoke(nativeContext('ws1'), CH.REPO_LIST_BANKS)).toEqual([BANK_FIXTURE[1]!])

    const other = createHarness(undefined, BANK_FIXTURE)
    expect(await other.invoke(nativeContext('ws2'), CH.REPO_LIST_BANKS)).toEqual([BANK_FIXTURE[2]!])
  })
})

describe('lazy materialization on read (D6)', () => {
  it('reads an unmaterialized owner bank and lands a non-empty tree with one commit', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'repo-handler-'))
    tempDirs.push(configDir)
    const provider = {
      listBanks: async () => [],
      loadBundle: async (bankId: string) => ({
        bankId,
        scope: 'workspace' as const,
        workspaceName: 'One',
        lessons: [
          {
            lessonKey: 'own rule',
            rule: 'Own rule',
            category: 'workflow',
            negative: false,
            pinned: false,
            disabled: false,
            tags: [],
            createdAt: '2026-10-09T00:00:00.000Z',
            source: { trigger: 'explicit' },
          },
        ],
        context: null,
        preferences: null,
        history: [],
      }),
    } as unknown as RepoSourceProvider
    const service = new MemoryRepoService({ configDir, git: unavailableGit, provider, debounceMs: 5 })
    const runtime = createRuntime([])
    runtime.service = service
    const harness = createHarness(runtime)

    const ownKey = ownerKey8For({ issuer: 'native', subject: 'agent' })
    const bank = `ws:ws1#${ownKey}`
    const tree = (await harness.invoke(nativeContext('ws1'), CH.REPO_TREE, bank)) as Array<{ path: string }>
    expect(tree.some((node) => node.path.startsWith('lessons/'))).toBe(true)

    // The projection now exists; a second read neither re-materializes nor adds
    // a commit (laziness), and the bank still exposes exactly one commit.
    const commits = (await harness.invoke(nativeContext('ws1'), CH.REPO_COMMITS, bank)) as unknown[]
    expect(commits).toHaveLength(1)
    const second = (await harness.invoke(nativeContext('ws1'), CH.REPO_COMMITS, bank)) as unknown[]
    expect(second).toHaveLength(1)
    await service.dispose()
  })

  it('a failed on-demand materialize never breaks the read', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'repo-handler-'))
    tempDirs.push(configDir)
    const provider = {
      listBanks: async () => [],
      loadBundle: async () => {
        throw new Error('provider down')
      },
    } as unknown as RepoSourceProvider
    const service = new MemoryRepoService({ configDir, git: unavailableGit, provider, debounceMs: 5 })
    const runtime = createRuntime([])
    runtime.service = service
    const harness = createHarness(runtime)

    const tree = (await harness.invoke(localContext('ws1'), CH.REPO_TREE, 'ws:ws1')) as unknown[]
    expect(tree).toEqual([])
    await service.dispose()
  })

  it('repoExport materializes on demand instead of exporting an empty archive', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'repo-handler-'))
    tempDirs.push(configDir)
    const provider = {
      listBanks: async () => [],
      loadBundle: async (bankId: string) => ({
        bankId,
        scope: 'workspace' as const,
        workspaceName: 'One',
        lessons: [
          {
            lessonKey: 'own rule',
            rule: 'Own rule',
            category: 'workflow',
            negative: false,
            pinned: false,
            disabled: false,
            tags: [],
            createdAt: '2026-10-09T00:00:00.000Z',
            source: { trigger: 'explicit' },
          },
        ],
        context: null,
        preferences: null,
        history: [],
      }),
    } as unknown as RepoSourceProvider
    const service = new MemoryRepoService({ configDir, git: unavailableGit, provider, debounceMs: 5 })
    const runtime = createRuntime([])
    runtime.service = service
    const harness = createHarness(runtime)

    // The bank has never been read, so nothing has materialized it yet.
    expect((await service.status('ws:ws1')).lastMaterializeAt).toBeNull()

    const result = (await harness.invoke(localContext('ws1'), CH.REPO_EXPORT, 'ws:ws1')) as { path: string; bytes: number }
    // The projection was rendered on demand: a non-empty archive, not the old
    // success-with-zero-bytes result.
    expect(result.bytes).toBeGreaterThan(0)
    expect((await service.status('ws:ws1')).lastMaterializeAt).not.toBeNull()
    await service.dispose()
  })
})

describe('wireRepoImportReady', () => {
  it('pushes memory:repoImportReady with [bankId, count] to the bank target', () => {
    const pushed: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const server = {
      push: (channel: string, target: unknown, ...args: unknown[]) => {
        pushed.push({ channel, target, args })
      },
    } as unknown as RpcServer
    let listener: ((bankId: string, editedFiles: string[]) => void) | undefined
    const service = {
      onEditedFilesChanged: (fn: (bankId: string, editedFiles: string[]) => void) => {
        listener = fn
        return () => {}
      },
    } as unknown as MemoryRepoService

    wireRepoImportReady(server, service)
    listener!('main', ['a.md', 'b.md'])
    listener!('ws:ws1', ['x.md'])
    listener!('ws:ws1#deadbeef', ['z.md'])

    expect(pushed).toEqual([
      { channel: CH.REPO_IMPORT_READY, target: { to: 'all' }, args: ['main', 2] },
      { channel: CH.REPO_IMPORT_READY, target: { to: 'workspace', workspaceId: 'ws1' }, args: ['ws:ws1', 1] },
      { channel: CH.REPO_IMPORT_READY, target: { to: 'workspace', workspaceId: 'ws1' }, args: ['ws:ws1#deadbeef', 1] },
    ])
  })
})

describe('bank id canonicalization (S1) and forced dream run (S6)', () => {
  it('canonicalizes a padded / implicit-local id before every downstream helper', async () => {
    const harness = createHarness()
    // `'  ws:ws1#local  '` and `'ws:ws1'` address ONE bank: the scheduler sees the canonical form.
    await harness.invoke(localContext('ws1'), CH.DREAM_RUN, '  ws:ws1#local  ')
    expect(harness.recorded).toContain('run:ws:ws1')
    await harness.invoke(localContext('ws1'), CH.REPO_STATUS, '  ws:ws1  ')
    expect(harness.recorded).toContain('status:ws:ws1')
    // `main#local` collapses to the ownerless main bank.
    await harness.invoke(localContext('ws1'), CH.DREAM_RUN, ' main#local ')
    expect(harness.recorded).toContain('run:main')
    // Authorization is unchanged: a padded foreign workspace is still rejected.
    expect(await rejection(() => harness.invoke(localContext('ws1'), CH.REPO_STATUS, '  ws:ws2  '))).toBe('Workspace access denied')
  })

  it('dreamRun forwards optional forced noteIds to the scheduler', async () => {
    const harness = createHarness()
    await harness.invoke(localContext('ws1'), CH.DREAM_RUN, 'main', { noteIds: ['a.md', 'b.md'] })
    expect(harness.recorded).toContain('run:main|a.md,b.md')
  })
})

describe('snapshots (no-git) repository reads over RPC (R8-6)', () => {
  // Mirrors the D6 harness: a real MemoryRepoService with an unavailable-git
  // double renders into `.snapshots/` instead of committing, and the RPC layer
  // is driven against it. No RPC test previously exercised status/commits/diff
  // on the degraded no-git path.
  function lessonProvider(): RepoSourceProvider {
    return {
      listBanks: async () => [],
      loadBundle: async (bankId: string) => ({
        bankId,
        scope: 'workspace' as const,
        workspaceName: 'One',
        lessons: [
          {
            lessonKey: 'own rule',
            rule: 'Own rule',
            category: 'workflow',
            negative: false,
            pinned: false,
            disabled: false,
            tags: [],
            createdAt: '2026-10-09T00:00:00.000Z',
            source: { trigger: 'explicit' },
          },
        ],
        context: null,
        preferences: null,
        history: [],
      }),
    } as unknown as RepoSourceProvider
  }

  it('status/commits/commitDiff serve a real snapshot-backed service', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'repo-handler-'))
    tempDirs.push(configDir)
    const service = new MemoryRepoService({ configDir, git: unavailableGit, provider: lessonProvider(), debounceMs: 5 })
    const runtime = createRuntime([])
    runtime.service = service
    const harness = createHarness(runtime)

    const ctx = localContext('ws1')
    // First read lazily materializes the projection; with no git it lands a snapshot.
    const status = (await harness.invoke(ctx, CH.REPO_STATUS, 'ws:ws1')) as MemoryRepoStatus
    expect(status.mode).toBe('snapshots')
    expect(status.head).not.toBeNull()

    const commits = (await harness.invoke(ctx, CH.REPO_COMMITS, 'ws:ws1')) as MemoryRepoCommit[]
    expect(commits.length).toBeGreaterThanOrEqual(1)
    const commit = commits[0]!
    expect(commit.sha).toBeTruthy()
    expect(commit.files.length).toBeGreaterThan(0)

    const diff = (await harness.invoke(ctx, CH.REPO_COMMIT_DIFF, 'ws:ws1', commit.sha)) as MemoryRepoCommitFile[]
    expect(diff.map((file) => file.path).sort()).toEqual(commit.files.map((file) => file.path).sort())
    expect(diff.every((file) => file.op === 'added' || file.op === 'modified')).toBe(true)

    await service.dispose()
  })
})

describe('dreamLog parsing and limit (R8-9)', () => {
  it('skips a corrupt line and honors the limit on the journal', async () => {
    const journalPath = join(resolveConfigDir(), 'memory', 'dream-log.jsonl')
    mkdirSync(dirname(journalPath), { recursive: true })
    const events: MemoryDreamEvent[] = [
      { ts: '2026-10-09T00:00:00.000Z', dreamId: 'd1', bankId: 'main', kind: 'start', message: 'started' },
      { ts: '2026-10-09T00:00:01.000Z', dreamId: 'd1', bankId: 'main', kind: 'distill', message: 'distilled' },
      { ts: '2026-10-09T00:00:02.000Z', dreamId: 'd1', bankId: 'main', kind: 'end', message: 'done' },
    ]
    writeFileSync(journalPath, ['{ not valid json', ...events.map((event) => JSON.stringify(event))].join('\n') + '\n', 'utf-8')
    try {
      const harness = createHarness()
      const ctx = localContext('ws1')
      const all = (await harness.invoke(ctx, CH.DREAM_LOG, 'main')) as MemoryDreamEvent[]
      expect(all.map((event) => event.kind)).toEqual(['start', 'distill', 'end'])
      expect(all.map((event) => event.ts)).toEqual(events.map((event) => event.ts))

      const limited = (await harness.invoke(ctx, CH.DREAM_LOG, 'main', 2)) as MemoryDreamEvent[]
      expect(limited.map((event) => event.kind)).toEqual(['distill', 'end'])
    } finally {
      rmSync(journalPath, { force: true })
    }
  })
})

describe('dreamLog bounded tail read (R8-9)', () => {
  const event = (over: Partial<MemoryDreamEvent> & Pick<MemoryDreamEvent, 'dreamId' | 'kind'>): MemoryDreamEvent => ({
    ts: '2026-10-09T00:00:00.000Z',
    bankId: 'main',
    message: 'event',
    ...over,
  })

  it('reads only the tail window, dropping the torn boundary line and skipping corrupt lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dream-log-'))
    tempDirs.push(dir)
    const journalPath = join(dir, 'dream-log.jsonl')

    // `big` is far older than the window and must never be read; `torn` is a
    // valid event the window starts in the middle of; the corrupt line sits
    // fully inside the window; `newest` are the two events that must survive.
    const big = event({ dreamId: 'big', kind: 'start', message: 'x'.repeat(400) })
    const torn = event({ dreamId: 'torn', kind: 'distill', message: 'this valid event is cut by the window' })
    const corrupt = '{ "ts": "not closed'
    const newest: MemoryDreamEvent[] = [
      event({ dreamId: 'd1', kind: 'end', message: 'first kept' }),
      event({ dreamId: 'd1', kind: 'commit', message: 'second kept' }),
    ]

    const suffix = [corrupt, ...newest.map((entry) => JSON.stringify(entry))].join('\n') + '\n'
    const content = [JSON.stringify(big), JSON.stringify(torn), suffix].join('\n')
    writeFileSync(journalPath, content, 'utf-8')

    // Window = the corrupt line + both newest events + 50 bytes back INTO `torn`,
    // so the window boundary lands mid-line and that line must be dropped whole.
    expect(Buffer.byteLength(JSON.stringify(torn), 'utf-8')).toBeGreaterThan(50)
    const maxBytes = Buffer.byteLength(suffix, 'utf-8') + 50

    const events = await readDreamLog(journalPath, undefined, maxBytes)
    expect(events.map((entry) => entry.kind)).toEqual(['end', 'commit'])
    expect(events.map((entry) => entry.dreamId)).toEqual(['d1', 'd1'])
    expect(events.some((entry) => entry.dreamId === 'big' || entry.dreamId === 'torn')).toBe(false)
  })

  it('returns every valid event (corrupt skipped) with a generous window and honors the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dream-log-'))
    tempDirs.push(dir)
    const journalPath = join(dir, 'dream-log.jsonl')

    const valid: MemoryDreamEvent[] = [
      event({ dreamId: 'd1', kind: 'start', ts: '2026-10-09T00:00:00.000Z' }),
      event({ dreamId: 'd1', kind: 'distill', ts: '2026-10-09T00:00:01.000Z' }),
      event({ dreamId: 'd1', kind: 'end', ts: '2026-10-09T00:00:02.000Z' }),
    ]
    writeFileSync(journalPath, ['{ not valid json', ...valid.map((entry) => JSON.stringify(entry))].join('\n') + '\n', 'utf-8')

    expect(DREAM_LOG_TAIL_BYTES).toBe(512 * 1024)
    const all = await readDreamLog(journalPath, undefined, 4096)
    expect(all.map((entry) => entry.kind)).toEqual(['start', 'distill', 'end'])
    expect(all.map((entry) => entry.ts)).toEqual(valid.map((entry) => entry.ts))

    const limited = await readDreamLog(journalPath, 2, 4096)
    expect(limited.map((entry) => entry.kind)).toEqual(['distill', 'end'])
  })
})