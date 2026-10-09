/**
 * `memory:repo*` + `memory:dream*` RPC bridge and process-wide runtime bootstrap
 * (Wave A, WP-03/§7 of docs/plans/2026-10-09-memory-repository-and-dreaming.md).
 *
 * Reads serve the deterministic git projection built by
 * `memory/repo/MemoryRepoService`; `memory:dreamRun` delegates to the single
 * process-wide `DreamScheduler`. Every handler authorizes first through the
 * memory handler's `authorizeMemoryWorkspace` and never trusts a workspace id
 * from the payload — the bank id (`main` | `ws:<workspaceId>`, owner-scoped
 * variants included) is the only selector.
 *
 * `startMemoryRepoRuntime` builds the git/service/dream stack once per process
 * (idempotent) with the A2 notify seam wired to `service.notifyMutation` plus
 * the `memory:repoChanged` push; `registerMemoryRepoHandlers` binds the RPC
 * channels including A8's import handlers (against a live bank accessor). Both
 * are called by `registerCoreRpcHandlers` so both hosts (Electron main,
 * standalone server) get them.
 */
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { PushTarget } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { getMemoryConfig } from '@rox/shared/config/storage'
import { createGitExec } from '@rox/shared/memory/git-exec'
import type {
  MemoryDreamEvent,
  MemoryDreamRun,
  MemoryDreamStatus,
  MemoryRepoBankInfo,
  MemoryRepoCommit,
  MemoryRepoCommitFile,
  MemoryRepoExportResult,
  MemoryRepoFile,
  MemoryRepoGraph,
  MemoryRepoStatus,
  MemoryRepoTreeNode,
} from '@rox/shared/memory/repo'
import { pushTyped, type RequestContext, type RpcServer } from '@rox/server-core/transport'
import { registerMemoryRepoToolRuntime } from '@rox/session-tools-core'
import type { HandlerDeps } from '../handler-deps'
import { authorizeMemoryRepoBank, authorizeMemoryWorkspace } from './memory'
import {
  registerMemoryRepoImportHandlers,
  type MemoryRepoImportRuntime,
  type MemoryRepoImportRuntimeAccessor,
} from './memory-repo-import'
import type { RepoImportKnownLesson } from '../../memory/repo/repo-import-parser'
import { renderRepoFiles } from '../../memory/repo/MemoryRepoMaterializer'
import { MemoryRepoService } from '../../memory/repo/MemoryRepoService'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { MemoryRepoSourceProvider, parseBankId } from '../../memory/repo/RepoSourceProvider'
import { DreamCostTracker } from '../../memory/repo/DreamCostTracker'
import { DreamNotesScanner, resolveDreamNotesRoot } from '../../memory/repo/DreamNotesScanner'
import { DreamRunner, type DreamMemoryService } from '../../memory/repo/DreamRunner'
import { DreamScheduler, type DreamSchedulerConfig } from '../../memory/repo/DreamScheduler'
import { setRepoNotifier, type RepoBankRef } from '../../memory/repo/notify'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.REPO_LIST_BANKS,
  RPC_CHANNELS.memory.REPO_STATUS,
  RPC_CHANNELS.memory.REPO_TREE,
  RPC_CHANNELS.memory.REPO_READ_FILE,
  RPC_CHANNELS.memory.REPO_COMMITS,
  RPC_CHANNELS.memory.REPO_COMMIT_DIFF,
  RPC_CHANNELS.memory.REPO_GRAPH,
  RPC_CHANNELS.memory.REPO_EXPORT,
  RPC_CHANNELS.memory.DREAM_STATUS,
  RPC_CHANNELS.memory.DREAM_RUN,
  RPC_CHANNELS.memory.DREAM_LOG,
] as const

/** The single process-wide repository/dream runtime, or null before bootstrap. */
export interface MemoryRepoRuntime {
  service: MemoryRepoService
  scheduler: DreamScheduler
  /** Set by `startMemoryRepoRuntime`; the import accessor needs both. */
  configDir?: string
  provider?: MemoryRepoSourceProvider
}

export interface MemoryRepoRuntimeDeps {
  server: RpcServer
  deps: HandlerDeps
  /** Override the config dir (tests); defaults to `resolveConfigDir()`. */
  configDir?: string
}

let activeRuntime: MemoryRepoRuntime | null = null

/** The process-wide runtime, or null before `startMemoryRepoRuntime`. */
export function getMemoryRepoRuntime(): MemoryRepoRuntime | null {
  return activeRuntime
}

/** `ws:<workspaceId>[#<ownerKey8>]` → workspaceId; everything else → null. */
function bankWorkspaceId(bankId: string): string | null {
  if (!bankId.startsWith('ws:')) return null
  const rest = bankId.slice(3)
  const hashAt = rest.indexOf('#')
  const id = hashAt >= 0 ? rest.slice(0, hashAt) : rest
  return id.length > 0 ? id : null
}

/** Push target for a bank: workspace banks → their workspace; `main*` → everyone. */
function bankTarget(bankId: string): PushTarget {
  const workspaceId = bankWorkspaceId(bankId)
  return workspaceId ? { to: 'workspace', workspaceId } : { to: 'all' }
}

/**
 * A8: translate the service's edited-set changes into `memory:repoImportReady`
 * (`[bankId, count]`). The service recomputes the set from the same logic that
 * backs `status().editedFiles` (an out-of-band edit in a text editor), dedupes
 * per bank by the sorted path list, and never emits for an empty set; `status()`
 * with no new edit therefore pushes nothing. Returns the unsubscribe fn.
 */
export function wireRepoImportReady(server: RpcServer, service: MemoryRepoService): () => void {
  return service.onEditedFilesChanged((bankId, editedFiles) => {
    pushTyped(server, RPC_CHANNELS.memory.REPO_IMPORT_READY, bankTarget(bankId), bankId, editedFiles.length)
  })
}

/** `{workspaceRoot}/memory` for workspace banks, `{configDir}/memory` otherwise. */
function memoryDirFor(configDir: string, bankId: string): string {
  const workspaceId = bankWorkspaceId(bankId)
  const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : undefined
  return workspace ? join(workspace.rootPath, 'memory') : join(configDir, 'memory')
}

/** Append one dream journal line (`dream-log.jsonl`), best-effort. */
async function appendDreamLog(path: string, event: MemoryDreamEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8')
}

/**
 * How much of the append-only `dream-log.jsonl` a read may touch. The journal is
 * never truncated, so reading it whole made the Dreams panel's reload cost grow
 * without bound over months of appends; only the tail window is ever read.
 */
export const DREAM_LOG_TAIL_BYTES = 512 * 1024

/** Read the last `length` bytes ending at `start`, or fewer if the file shrank. */
async function readFileTail(path: string, start: number, length: number): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const chunks: Buffer[] = []
    let position = start
    let remaining = length
    while (remaining > 0) {
      const buffer = Buffer.allocUnsafe(Math.min(remaining, 64 * 1024))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      chunks.push(buffer.subarray(0, bytesRead))
      position += bytesRead
      remaining -= bytesRead
    }
    return Buffer.concat(chunks).toString('utf-8')
  } finally {
    await handle.close()
  }
}

/** Last `limit` dream journal lines (chronological). Missing journal → []. */
export async function readDreamLog(
  path: string,
  limit?: number,
  maxBytes: number = DREAM_LOG_TAIL_BYTES,
): Promise<MemoryDreamEvent[]> {
  let raw: string
  if (maxBytes > 0) {
    let size: number
    try {
      const handle = await open(path, 'r')
      try {
        size = (await handle.stat()).size
      } finally {
        await handle.close()
      }
    } catch {
      return []
    }
    const start = Math.max(0, size - maxBytes)
    const tail = await readFileTail(path, start, size - start)
    if (tail === null) return []
    raw = tail
    // The window may start mid-line: drop the leading partial line (its tail is
    // torn) so a truncated JSON fragment can never surface as an event.
    if (start > 0) {
      const newline = raw.indexOf('\n')
      raw = newline >= 0 ? raw.slice(newline + 1) : ''
    }
  } else {
    try {
      raw = await readFile(path, 'utf-8')
    } catch {
      return []
    }
  }
  const events: MemoryDreamEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as MemoryDreamEvent
      if (parsed && typeof parsed.ts === 'string' && typeof parsed.kind === 'string') events.push(parsed)
    } catch {
      // A corrupt line never breaks the log view.
    }
  }
  return typeof limit === 'number' && limit > 0 ? events.slice(-limit) : events
}

export function registerMemoryRepoHandlers(server: RpcServer, deps: HandlerDeps, runtime?: MemoryRepoRuntime): void {
  const configDir = resolveConfigDir()
  const requireRuntime = (): MemoryRepoRuntime => {
    const resolved = runtime ?? getMemoryRepoRuntime()
    if (!resolved) throw new Error('Memory repository runtime is not started')
    return resolved
  }

  /**
   * D6: authorize a bank read (returning its CANONICAL id) and lazily
   * materialize its projection when none has ever been recorded (owner-scoped
   * banks have no write path that does). A materialize failure never breaks the
   * read — the handler falls back to the (empty) projection and logs the error.
   */
  const openBank = async (ctx: RequestContext, bankId: string): Promise<{ service: MemoryRepoService; bankId: string }> => {
    const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
    const service = requireRuntime().service
    try {
      await service.ensureMaterialized(canonical, 'on-demand')
    } catch (error) {
      deps.platform.logger?.warn?.(
        `MEMORY_REPO: on-demand materialize failed for ${canonical}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return { service, bankId: canonical }
  }

  // D5: a principal is bound to a single workspace, so it must not enumerate
  // every bank on the host. Local callers keep the full list.
  server.handle(RPC_CHANNELS.memory.REPO_LIST_BANKS, async (ctx): Promise<MemoryRepoBankInfo[]> => {
    const boundId = authorizeMemoryWorkspace(ctx, undefined, deps)
    const banks = await requireRuntime().service.listBanks()
    if (!ctx.principal) return banks
    const own = boundId ? `ws:${boundId}` : null
    return own ? banks.filter((bank) => bank.id === own) : []
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_STATUS, async (ctx, bankId: string): Promise<MemoryRepoStatus> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.status(bank.bankId)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_TREE, async (ctx, bankId: string): Promise<MemoryRepoTreeNode[]> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.tree(bank.bankId)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_READ_FILE, async (ctx, bankId: string, path: string): Promise<MemoryRepoFile> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.readFile(bank.bankId, path)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_COMMITS, async (ctx, bankId: string, limit?: number): Promise<MemoryRepoCommit[]> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.listCommits(bank.bankId, limit)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_COMMIT_DIFF, async (ctx, bankId: string, sha: string): Promise<MemoryRepoCommitFile[]> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.commitDiff(bank.bankId, sha)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.REPO_GRAPH, async (ctx, bankId: string): Promise<MemoryRepoGraph> => {
    const bank = await openBank(ctx, bankId)
    return bank.service.graph(bank.bankId)
  }, { nativeAction: 'read' })

  // Export writes a zip into the config dir — a write action. Mirror openBank:
  // materialize on demand, else a never-materialized bank exports an EMPTY
  // archive with a success result.
  server.handle(RPC_CHANNELS.memory.REPO_EXPORT, async (ctx, bankId: string): Promise<MemoryRepoExportResult> => {
    const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
    const service = requireRuntime().service
    try {
      await service.ensureMaterialized(canonical, 'on-demand')
    } catch (error) {
      deps.platform.logger?.warn?.(
        `MEMORY_REPO: on-demand materialize failed for ${canonical}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return service.exportZip(canonical)
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.DREAM_STATUS, async (ctx, bankId: string): Promise<MemoryDreamStatus> => {
    const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
    return requireRuntime().scheduler.status(canonical)
  }, { nativeAction: 'read' })

  server.handle(
    RPC_CHANNELS.memory.DREAM_RUN,
    async (ctx, bankId: string, opts?: { noteIds?: string[] }): Promise<MemoryDreamRun> => {
      const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
      // D2: the scheduler's run-finished subscription owns `memory:dreamDone`
      // (it pushes the finished run once the run is recorded); the handler only
      // returns the run.
      // A forced run (`{noteIds}`) distils exactly those notes even when unchanged.
      return requireRuntime().scheduler.runNow(canonical, opts)
    },
    { nativeAction: 'write' },
  )

  server.handle(RPC_CHANNELS.memory.DREAM_LOG, async (ctx, bankId: string, limit?: number): Promise<MemoryDreamEvent[]> => {
    const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
    return readDreamLog(join(memoryDirFor(configDir, canonical), 'dream-log.jsonl'), limit)
  }, { nativeAction: 'read' })

  // A8: import review/apply/revert against a live bank view (needs the runtime).
  registerMemoryRepoImportHandlers(server, deps, importAccessorFor(runtime ?? getMemoryRepoRuntime()))

  // Publish the memory-repo runtime for the memory_repo_read / memory_repo_search
  // session tools — mirrors registerKnowledgeToolRuntime in knowledge.ts. The
  // accessor is lazy so registration order against startMemoryRepoRuntime does
  // not matter; with no runtime the tools answer MEMORY_REPO_UNAVAILABLE.
  const serviceFor = (): MemoryRepoService | null => (runtime ?? getMemoryRepoRuntime())?.service ?? null
  registerMemoryRepoToolRuntime({
    listBanks: async () => (await serviceFor()?.listBanks()) ?? [],
    tree: async (bankId) => {
      const service = serviceFor()
      if (!service) throw new Error('Memory repository runtime is not started')
      return service.tree(bankId)
    },
    readFile: async (bankId, path) => {
      const service = serviceFor()
      if (!service) throw new Error('Memory repository runtime is not started')
      return service.readFile(bankId, path)
    },
    // Memory session tools run as the local user but are bound to one session
    // workspace; map its folder back to the workspace id so the handlers can
    // keep every bank address inside that workspace (+ local `main`).
    resolveWorkspaceId: (workspacePath) =>
      deps.sessionManager.getWorkspaces().find((workspace) => workspace.rootPath === workspacePath)?.id ?? null,
  })
}

/**
 * Bank view for the import handlers: working-tree files from the service and the
 * projected lesson set from the materializer. Undefined until the runtime exists
 * (import channels then answer "bank not found").
 */
function importAccessorFor(runtime: MemoryRepoRuntime | null): MemoryRepoImportRuntimeAccessor | undefined {
  if (!runtime?.provider || !runtime.configDir) return undefined
  const { service, provider, configDir } = runtime
  return async (bankId): Promise<MemoryRepoImportRuntime | null> => {
    const parsed = parseBankId(bankId)
    const workspaceId = parsed.scope === 'workspace' ? parsed.workspaceId ?? null : null
    const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : undefined
    // An unmaterialized bank has no working tree yet — importing from it is meaningless.
    const status = await service.status(bankId)
    if (!status.lastMaterializeAt) return null
    const files: Array<{ path: string; content: string }> = []
    for (const node of await service.tree(bankId)) {
      if (node.type !== 'file') continue
      try {
        const file = await service.readFile(bankId, node.path)
        files.push({ path: node.path, content: file.content })
      } catch {
        // A vanished file is simply absent from the import view.
      }
    }
    const bundle = await provider.loadBundle(bankId)
    const byKey = new Map(bundle.lessons.map((lesson) => [lesson.lessonKey, lesson]))
    const known: RepoImportKnownLesson[] = renderRepoFiles(bundle, { generatedAt: new Date().toISOString() })
      .filter((file) => file.kind === 'lesson' && file.lessonKey)
      .map((file) => {
        const lesson = byKey.get(file.lessonKey!)
        return {
          path: file.path,
          lessonId: file.lessonId ?? file.lessonKey!,
          ruleHash: file.ruleHash ?? '',
          // The projected base hash is the rendered rule hash (spec §5 baseHash).
          ...(file.ruleHash ? { baseHash: file.ruleHash } : {}),
          rule: lesson?.rule ?? '',
          disabled: lesson?.disabled ?? false,
        }
      })
    return {
      bankId,
      scope: parsed.scope,
      workspaceId,
      ...(workspace ? { workspaceRoot: workspace.rootPath } : {}),
      memoryDir: memoryDirFor(configDir, bankId),
      files,
      known,
    }
  }
}

/** Build (or return) the process-wide repository + dream runtime. Idempotent. */
export function startMemoryRepoRuntime(input: MemoryRepoRuntimeDeps): MemoryRepoRuntime {
  if (activeRuntime) return activeRuntime
  const { server, deps } = input
  const configDir = input.configDir ?? resolveConfigDir()

  const dreamConfig = (): DreamSchedulerConfig => {
    const c = getMemoryConfig()
    return {
      dreamIntervalHours: c.dreamIntervalHours,
      ...(c.dreamModel ? { dreamModel: c.dreamModel } : {}),
      dreamNotes: c.dreamNotes,
    }
  }

  const git = createGitExec()
  const configuredRepoDir = getMemoryConfig().repoDir
  const provider = new MemoryRepoSourceProvider({
    configDir,
    ...(configuredRepoDir ? { repoDir: configuredRepoDir } : {}),
    getWorkspaces: () => deps.sessionManager.getWorkspaces(),
  })
  const service = new MemoryRepoService({
    configDir,
    git,
    provider,
    getConfig: () => {
      const c = getMemoryConfig()
      return {
        dreamIntervalHours: c.dreamIntervalHours,
        ...(c.dreamModel ? { dreamModel: c.dreamModel } : {}),
        dreamNotes: c.dreamNotes,
        ...(c.repoDir ? { repoDir: c.repoDir } : {}),
      }
    },
  })

  const cost = new DreamCostTracker()
  // Per-bank notes root: the Notes UI/RPC rule (custom `notesPath`, else
  // `{defaultWorkspacesDir}/<workspaceId>/notes`) with the knowledge-source
  // vault as fallback — see `resolveDreamNotesRoot`. `DreamRunner` hands the
  // scanner only the bank's workspace root (which `resolveWorkspaceRoot` below
  // derives from the bank id); recover the matching workspace id here so the
  // default-root rule applies for `ws:<id>` banks and the global `main` bank
  // (no root) resolves to null instead of scanning another workspace's notes.
  const notes = new DreamNotesScanner({
    stateFile: join(configDir, 'memory', 'notes-watermark.json'),
    resolveNotesRoot: (workspaceId, workspaceRoot) => {
      const id =
        workspaceId ??
        deps.sessionManager.getWorkspaces().find((workspace) => workspace.rootPath === workspaceRoot)?.id ??
        null
      return resolveDreamNotesRoot(id, workspaceRoot)
    },
  })

  // A8: an out-of-band edit (a materialized file touched in a text editor) has
  // no RPC in flight — `status()`/`materialize()` detect the divergence and this
  // pushes `memory:repoImportReady` once per distinct edited set.
  const unsubscribeImportReady = wireRepoImportReady(server, service)

  const journalFor = (bankId: string): string => join(memoryDirFor(configDir, bankId), 'dream-log.jsonl')

  const memoryServiceAccessor = deps.sessionManager as unknown as {
    getMemoryServiceForBank?: (bankId: string) => DreamMemoryService | null
  }

  const runner = new DreamRunner({
    repo: service,
    cost,
    getMemoryService: async (bankId) => {
      // The accessor resolves the full bank id itself (`ws:<id>` with an ignored
      // `#<owner8>` suffix; `main`/unknown → null). Passing a bare workspace id
      // here silently disabled steps 1 (whenIdle) and 4 (decay) for every bank.
      return memoryServiceAccessor.getMemoryServiceForBank?.(bankId) ?? null
    },
    getLearning: async (bankId) => {
      const workspaceId = bankWorkspaceId(bankId)
      const learning = deps.learning
      if (!workspaceId || !learning) return null
      return { runConsolidation: (id: string) => learning.runConsolidation(id) }
    },
    notes,
    resolveWorkspaceRoot: (bankId) => {
      const workspaceId = bankWorkspaceId(bankId)
      if (!workspaceId) return undefined
      return deps.sessionManager.getWorkspaces().find((workspace) => workspace.id === workspaceId)?.rootPath
    },
    distiller: async (prompt, bankId) => {
      const workspaceId = bankWorkspaceId(bankId) ?? deps.sessionManager.getWorkspaces()[0]?.id
      if (!workspaceId) return { text: '' }
      return { text: await deps.sessionManager.runDistillOneShot(workspaceId, prompt) }
    },
    proposalsFor: async (bankId) => new MemoryProposalStore(memoryDirFor(configDir, bankId)),
    log: (event) => appendDreamLog(journalFor(event.bankId), event),
    writeDreams: (bankId, md) => service.writeRepoFile(bankId, 'DREAMS.md', md),
    config: dreamConfig,
  })

  const scheduler = new DreamScheduler({
    runner,
    repo: service,
    log: (event) => appendDreamLog(journalFor(event.bankId), event),
    config: dreamConfig,
    // Restart seam: the durable per-bank journal is the only state that outlives
    // the process, so `hydrate()` replays it to restore the window ledger.
    readJournal: (bankId) => readDreamLog(journalFor(bankId)),
  })

  const runtime: MemoryRepoRuntime = { service, scheduler, configDir, provider }
  activeRuntime = runtime

  // A2's process-wide mutation seam: `notifyMutation` only schedules the
  // debounce; the `memory:repoChanged` push happens when the batch settles
  // (D4), so an open screen reloads the committed projection, not the pre-change
  // state, and a no-op batch still refreshes the UI.
  setRepoNotifier((bank: RepoBankRef, reason: string) => {
    service.notifyMutation(bank, reason)
  })
  const unsubscribeMaterialized = service.onMaterialized((bankId, _result, reason) => {
    pushTyped(server, RPC_CHANNELS.memory.REPO_CHANGED, bankTarget(bankId), bankId, reason)
  })

  // Dream journal → renderer stream; a finished run → `memory:dreamDone`. Only
  // `end` marks completion — an `error` event is a mid-run step failure and must
  // not push a `dreamDone` built from an in-flight run (D3). The run-finished
  // notification fires inside `runBank` once `lastRun` is recorded, so the push
  // carries exactly the just-finished run and never races the trailing `end`
  // event's journal I/O (R8-1: a 0 ms timer could fire before `lastRun` landed).
  const unsubscribeDreamEvent = scheduler.onEvent((event) => {
    pushTyped(server, RPC_CHANNELS.memory.DREAM_EVENT, bankTarget(event.bankId), event)
  })
  const unsubscribeDreamDone = scheduler.onRunFinished((run) => {
    pushTyped(server, RPC_CHANNELS.memory.DREAM_DONE, bankTarget(run.bankId), run)
  })

  // Restore window state from the durable journal BEFORE the first tick: without
  // this the first 60 s tick re-runs every bank and the Dreams panel reports
  // "never dreamed" after each app restart. `status()`/`tickOnce()` await this.
  void scheduler.hydrate()
  scheduler.start()

  // Host-owned background tasks are disposed with the transport (server.ts
  // contract: `onShutdown`). Without this an in-process close with the app
  // continuing (Electron bootstrap-failure path) leaves the 60 s scheduler
  // interval ticking and a debounced commit running against a dead transport.
  server.onShutdown?.(() => {
    unsubscribeDreamEvent()
    unsubscribeDreamDone()
    unsubscribeMaterialized()
    unsubscribeImportReady()
    scheduler.stop()
    setRepoNotifier(null)
    void service.dispose()
    // Guarded: never clear a newer runtime installed by a later bootstrap.
    if (activeRuntime === runtime) activeRuntime = null
  })

  return runtime
}