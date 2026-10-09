/**
 * MemoryRepoService — the single writer for memory repositories (spec §4-§6,
 * contract §3).
 *
 * Layout: `{repoDir ?? configDir/memory/repos}/main/<ownerKey8>/` and
 * `.../ws-<sha1(workspaceId)[:8]>/<ownerKey8>/`; git lives in `<repo>/.git-rox`
 * and EVERY git call carries explicit `GIT_DIR`/`GIT_WORK_TREE`, so git never
 * discovers (or commits into) a parent repository. When git is unavailable the
 * same materialization writes full snapshots under `.snapshots/<ts>/`.
 *
 * Guarantees:
 * - deterministic: unchanged sources write nothing and produce no commit;
 * - one commit per batch (debounce + per-bank mutex);
 * - human edits are never overwritten (`baseHash` guard → `.conflicts/<ts>/`);
 * - no telemetry in repo files; `sourceRev` is the hash of the rendered
 *   (telemetry-free) projection.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { GitExec, GitExecResult } from '@rox/shared/memory/git-exec'
import type {
  MemoryRepoBankInfo,
  MemoryRepoCommit,
  MemoryRepoCommitFile,
  MemoryRepoExportResult,
  MemoryRepoFile,
  MemoryRepoGraph,
  MemoryRepoStatus,
  MemoryRepoTreeNode,
} from '@rox/shared/memory/repo'
import { lessonFileId, renderRepoFiles, type RenderedRepoFile } from './MemoryRepoMaterializer'
import { formatBankId, memoryRepoPath, parseBankId, type RepoSourceProvider } from './RepoSourceProvider'
import type { RepoBankRef } from './notify'
import { createSnapshot, isReservedRepoPath, isSafeRelativePath, lastSnapshot, listRepoFiles, readSnapshots, snapshotDiff, type SnapshotFileRef } from './snapshots'

export interface MemoryRepoServiceDeps {
  configDir: string
  git: GitExec
  provider: RepoSourceProvider
  getConfig?: () => { dreamIntervalHours: number; dreamModel?: string; dreamNotes: boolean; repoDir?: string }
  now?: () => Date
  debounceMs?: number
}

/**
 * Edited-set listener (`memory:repoImportReady` upstream): called once per
 * distinct sorted path list for a bank, never for an empty set.
 */
export type EditedFilesListener = (bankId: string, editedFiles: string[]) => void

/** Outcome of one materialization batch (commit or no-op). */
export interface RepoMaterializeResult {
  committed: boolean
  sha?: string
  files: number
  edited: string[]
  /**
   * Set when the batch could not land (git add/diff/commit failed) — the trimmed
   * git stderr (or an exit-code fallback). Distinguishes a failed commit from a
   * genuinely empty batch, whose result carries no `error`.
   */
  error?: string
}

/**
 * Settled-batch listener (`memory:repoChanged` upstream): called once per
 * completed `materialize()` after the per-bank mutex releases, whether or not
 * the batch committed.
 */
export type MaterializedListener = (bankId: string, result: RepoMaterializeResult, reason: string) => void

interface RepoMeta {
  version: 1
  bankId: string
  sourceRev: string
  headOfMaterialize: string | null
  writtenAt: string
  /** Rendered-managed files: path → sha1 of the bytes we last wrote. */
  files: Record<string, string>
  /** Auxiliary files (DREAMS.md) written via `writeRepoFile`; never deleted by materialize. */
  aux: Record<string, string>
  /** Auxiliary paths written since the last commit (staged by the next materialize). */
  pendingAux: Record<string, true>
  /** Paths whose on-disk bytes differ from what we wrote (human edits). */
  edited: Record<string, true>
  /**
   * Paths staged in a batch that FAILED to commit → sha1 of the bytes we left on
   * disk. Lets the next materialize recognize our own abandoned write (even when
   * the render changed) as ours: re-stage it, never quarantine it. Cleared on a
   * batch that lands.
   */
  uncommitted: Record<string, string>
}

interface DiskFile {
  exists: boolean
  hash: string
}

const READ_FILE_LIMIT = 1_000_000
const DEFAULT_DEBOUNCE_MS = 5000
const MAX_COMMITS = 100
/** Default page size for `listCommits` when the caller's limit is missing/invalid. */
const DEFAULT_COMMIT_LIMIT = 30

/** Full/abbreviated hex object id — the only revision shape callers may name. */
const REVISION_RE = /^[0-9a-f]{4,64}$/i
/** Symbolic refs we deliberately accept from a caller. */
const ALLOWED_REVISIONS: Record<string, true> = { HEAD: true }

/**
 * Reject anything that git could parse as an option (e.g. `--output=/etc/x`)
 * before a caller-supplied revision reaches argv. The thrown message is the
 * same as a miss so the RPC cannot distinguish an unsafe value from an
 * unknown commit.
 */
function assertRevision(rev: string): void {
  if (REVISION_RE.test(rev) || ALLOWED_REVISIONS[rev] === true) return
  throw new Error(`commit not found: ${rev}`)
}

function sha1Hex(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex')
}

function nowCompact(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

function readDiskFile(abs: string): DiskFile {
  try {
    return { exists: true, hash: sha1Hex(readFileSync(abs)) }
  } catch {
    return { exists: false, hash: '' }
  }
}

function writeFileAtomic(abs: string, content: string): void {
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = `${abs}.${process.pid}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, abs)
}

function samePath(a: string, b: string): boolean {
  if (!a) return false
  const norm = (path: string): string => {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }
  return norm(a) === norm(b)
}

/** Reject neighbour paths in none of the rendered set (defence-in-depth). */
function safeJoin(repoPath: string, path: string): string | null {
  if (!isSafeRelativePath(path)) return null
  const abs = join(repoPath, ...path.split('/'))
  const rel = relative(repoPath, abs)
  if (rel.startsWith('..') || rel === '') return null
  return abs
}

/** Best-effort real path: `realpathSync`, falling back to `resolve` when it fails. */
function bestRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Real path of the nearest existing ancestor of `target` (best-effort). Used to
 * veto a write whose parent chain escapes the bank through a symlinked dir.
 */
function nearestExistingRealpath(target: string): string {
  let cur = target
  while (!existsSync(cur)) {
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return bestRealpath(cur)
}

/** CRC-32 (IEEE 802.3) — named polynomial, table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Minimal store-only (method 0) ZIP writer — no new dependency. */
function writeStoredZip(entries: Array<{ path: string; data: Buffer }>, outPath: string): number {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const name = Buffer.from(entry.path, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x0021, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x0021, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, entry.data)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.concat([...locals, centralBuf, eocd]))
  return statSync(outPath).size
}

export class MemoryRepoService {
  private readonly configDir: string
  private readonly git: GitExec
  private readonly provider: RepoSourceProvider
  private readonly nowProvider: () => Date
  private readonly debounceMs: number
  private readonly getConfigFn: (() => { dreamIntervalHours: number; dreamModel?: string; dreamNotes: boolean; repoDir?: string }) | undefined
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly pendingReason = new Map<string, string>()
  private readonly editedListeners = new Set<EditedFilesListener>()
  private readonly materializedListeners = new Set<MaterializedListener>()
  /** Last EMITTED sorted edited set per bank, `\0`-joined (monotonic; see `noteEditedFiles`). */
  private readonly editedKeys = new Map<string, string>()
  private disposed = false

  readonly repoPathFor: (bankId: string, ownerKey: string) => string

  constructor(deps: MemoryRepoServiceDeps) {
    this.configDir = deps.configDir
    this.git = deps.git
    this.provider = deps.provider
    this.getConfigFn = deps.getConfig
    this.nowProvider = deps.now ?? (() => new Date())
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.repoPathFor = (bankId, ownerKey) => {
      const repoDir = this.config().repoDir
      return memoryRepoPath({ configDir: this.configDir, ...(repoDir ? { repoDir } : {}) }, bankId, ownerKey)
    }
  }

  private config(): { dreamIntervalHours: number; dreamModel?: string; dreamNotes: boolean; repoDir?: string } {
    return this.getConfigFn?.() ?? { dreamIntervalHours: 4, dreamNotes: true }
  }

  /**
   * One canonical spelling per repository: `formatBankId(parseBankId(id))`
   * (trimmed, `#local` collapsed). Every entry point normalizes through this so
   * the per-bank mutex, the meta read-modify-write and the repo path never split
   * one bank across `'ws:w1'`, `'ws:w1#local'` and `' ws:w1'`.
   */
  private canonicalBankId(bankId: string): string {
    const parsed = parseBankId(bankId)
    return formatBankId(parsed.scope, parsed.workspaceId, parsed.ownerKey8)
  }

  private runGit(repoPath: string, args: string[]): Promise<GitExecResult> {
    return this.git.run(args, { cwd: repoPath, env: { GIT_DIR: join(repoPath, '.git-rox'), GIT_WORK_TREE: repoPath } })
  }

  private readMeta(repoPath: string): RepoMeta | null {
    try {
      const parsed = JSON.parse(readFileSync(`${repoPath}.meta.json`, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.version === 1) {
        return {
          ...parsed,
          aux: parsed.aux ?? {},
          pendingAux: parsed.pendingAux ?? {},
          edited: parsed.edited ?? {},
          uncommitted: parsed.uncommitted ?? {},
        }
      }
      return null
    } catch {
      return null
    }
  }

  private writeMeta(repoPath: string, meta: RepoMeta): void {
    writeFileAtomic(`${repoPath}.meta.json`, JSON.stringify(meta, null, 2) + '\n')
  }

  private async detectMode(repoPath: string): Promise<'git' | 'snapshots'> {
    if (!(await this.git.available())) return 'snapshots'
    mkdirSync(repoPath, { recursive: true })
    let isRepo = samePath((await this.runGit(repoPath, ['rev-parse', '--show-toplevel'])).stdout.trim(), repoPath)
    if (!isRepo) {
      const init = await this.runGit(repoPath, ['init', '-q', '-b', 'main'])
      if (!init.ok) return 'snapshots'
      isRepo = samePath((await this.runGit(repoPath, ['rev-parse', '--show-toplevel'])).stdout.trim(), repoPath)
    }
    if (!isRepo) return 'snapshots'
    this.ensureGitExclude(repoPath)
    return 'git'
  }

  /**
   * `$GIT_DIR/info/exclude` for the things git would otherwise see as untracked
   * inside the memory work tree (a separately named git dir is not auto-ignored).
   */
  private ensureGitExclude(repoPath: string): void {
    const content = '.git-rox/\n.meta.json\n*.tmp\n.conflicts/\n.snapshots/\n'
    const file = join(repoPath, '.git-rox', 'info', 'exclude')
    try {
      if (readFileSync(file, 'utf8') === content) return
    } catch {
      // missing file — write it below
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  /** True when a bare `git` would resolve to a DIFFERENT tree above the repo path. */
  private async detectForeignTree(repoPath: string): Promise<boolean> {
    if (!existsSync(repoPath)) return false
    const probe = await this.git.run(['rev-parse', '--show-toplevel'], { cwd: repoPath })
    return probe.ok && probe.stdout.trim().length > 0 && !samePath(probe.stdout.trim(), repoPath)
  }

  private async revParseHead(repoPath: string): Promise<string | null> {
    const result = await this.runGit(repoPath, ['rev-parse', 'HEAD'])
    return result.ok && result.stdout.trim() ? result.stdout.trim() : null
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.locks.set(key, next.then(() => undefined, () => undefined))
    return next
  }

  // ── frozen API ────────────────────────────────────────────────────────────

  async listBanks(): Promise<MemoryRepoBankInfo[]> {
    return this.provider.listBanks()
  }

  async dreamBankIds(): Promise<string[]> {
    return (await this.provider.listBanks()).map((bank) => bank.id)
  }

  async status(bankId: string): Promise<MemoryRepoStatus> {
    bankId = this.canonicalBankId(bankId)
    const parsed = parseBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    mkdirSync(repoPath, { recursive: true })
    const mode = await this.detectMode(repoPath)
    const meta = this.readMeta(repoPath)
    const foreignTree = await this.detectForeignTree(repoPath)

    let head: MemoryRepoStatus['head'] = null
    if (mode === 'git') {
      const log = await this.runGit(repoPath, ['log', '-1', '--format=%H%x1f%cI%x1f%s'])
      if (log.ok && log.stdout.trim()) {
        const [sha = '', ts = '', ...rest] = log.stdout.trim().split('\x1f')
        if (sha) head = { sha, message: rest.join('\x1f'), ts }
      }
    } else {
      const last = lastSnapshot(repoPath)
      if (last) head = { sha: last.id, message: last.message, ts: last.ts }
    }

    const cfg = this.config()
    const editedFiles = this.editedFiles(repoPath, meta)
    this.noteEditedFiles(bankId, editedFiles)
    return {
      bankId,
      scope: parsed.scope,
      repoPath,
      mode,
      head,
      lastMaterializeAt: meta?.writtenAt ?? null,
      dirty: await this.isDirty(repoPath, mode),
      editedFiles,
      foreignTree,
      // D1: editedFiles.length is the import review/revert backlog the UI banner keys on.
      pendingImportCount: editedFiles.length,
      dream: {
        lastRunAt: null,
        nextRunAt: null,
        intervalHours: cfg.dreamIntervalHours,
        ...(cfg.dreamModel ? { model: cfg.dreamModel } : {}),
        costTodayUsd: 0,
        costIsEstimate: true,
      },
    }
  }

  private editedFiles(repoPath: string, meta: RepoMeta | null): string[] {
    if (!meta) return []
    const paths = new Set<string>([...Object.keys(meta.edited), ...Object.keys(meta.files)])
    const edited: string[] = []
    for (const path of paths) {
      const abs = safeJoin(repoPath, path)
      if (!abs) continue
      const disk = readDiskFile(abs)
      if (!disk.exists) continue
      if (disk.hash !== meta.files[path]) edited.push(path)
    }
    return edited.sort()
  }

  /**
   * Subscribe to edited-set changes (the `memory:repoImportReady` signal): the
   * listener fires once per distinct sorted path list for a bank and never for
   * an empty list. Returns an unsubscribe function.
   */
  onEditedFilesChanged(listener: EditedFilesListener): () => void {
    this.editedListeners.add(listener)
    return () => {
      this.editedListeners.delete(listener)
    }
  }

  /**
   * Subscribe to settled materialization batches: fires once per completed
   * `materialize()` (after the per-bank mutex releases) whether or not a commit
   * happened. The runtime uses this to push `memory:repoChanged` after a batch
   * settles instead of at notify time. Returns the unsubscribe function.
   */
  onMaterialized(listener: MaterializedListener): () => void {
    this.materializedListeners.add(listener)
    return () => {
      this.materializedListeners.delete(listener)
    }
  }

  private noteMaterialized(bankId: string, result: RepoMaterializeResult, reason: string): void {
    for (const listener of [...this.materializedListeners]) {
      try {
        listener(bankId, result, reason)
      } catch {
        // advisory: a listener failure must never break materialize
      }
    }
  }

  /**
   * Dedupe by the stable (sorted) path list, then fan out. Monotonic per bank:
   * the recorded key only ever advances to a non-empty set that has actually
   * been emitted, so a stale `status()` snapshot replaying a set that was
   * already emitted is suppressed instead of rewinding the bookkeeping. A set
   * reverting to empty emits nothing and leaves the key untouched; a different
   * non-empty set is the only thing that re-arms the signal.
   */
  private noteEditedFiles(bankId: string, editedFiles: string[]): void {
    const key = editedFiles.join('\u0000')
    if (this.editedKeys.get(bankId) === key) return
    if (editedFiles.length > 0) this.editedKeys.set(bankId, key)
    if (editedFiles.length === 0 || this.editedListeners.size === 0) return
    for (const listener of [...this.editedListeners]) {
      try {
        listener(bankId, editedFiles)
      } catch {
        // advisory: a listener failure must never break status/materialize
      }
    }
  }

  private async isDirty(repoPath: string, mode: 'git' | 'snapshots'): Promise<boolean> {
    if (mode === 'snapshots') return false
    const status = await this.runGit(repoPath, ['status', '--porcelain'])
    return status.ok && status.stdout.trim().length > 0
  }

  async tree(bankId: string): Promise<MemoryRepoTreeNode[]> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    const meta = this.readMeta(repoPath)
    const edited = new Set(this.editedFiles(repoPath, meta))
    const nodes: MemoryRepoTreeNode[] = []
    const seenDirs = new Set<string>()
    for (const path of listRepoFiles(repoPath)) {
      const segments = path.split('/')
      for (let depth = 0; depth < segments.length - 1; depth++) {
        const dir = segments.slice(0, depth + 1).join('/')
        if (seenDirs.has(dir)) continue
        seenDirs.add(dir)
        nodes.push({ path: dir, name: segments[depth]!, type: 'dir', depth })
      }
      const badges: Array<'edited' | 'dreamed'> = []
      if (edited.has(path)) badges.push('edited')
      if (path === 'DREAMS.md') badges.push('dreamed')
      const abs = safeJoin(repoPath, path)
      let sizeBytes: number | undefined
      try {
        sizeBytes = abs ? statSync(abs).size : undefined
      } catch {
        sizeBytes = undefined
      }
      nodes.push({ path, name: segments[segments.length - 1]!, type: 'file', depth: segments.length - 1, ...(badges.length ? { badges } : {}), ...(sizeBytes === undefined ? {} : { sizeBytes }) })
    }
    return nodes.sort((a, b) => (a.path === b.path ? 0 : a.path.localeCompare(b.path)))
  }

  async readFile(bankId: string, path: string): Promise<MemoryRepoFile> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    const abs = safeJoin(repoPath, path)
    if (!abs) throw new Error(`invalid path: ${path}`)
    // Internal bookkeeping (.git-rox/.snapshots/.conflicts/*.tmp) is hidden from
    // tree()/exportZip; never serve it through a direct read either.
    if (isReservedRepoPath(path)) throw new Error(`invalid path: ${path}`)
    // Lexical safety is not enough: a symlink planted inside the bank would
    // escape the root once readFileSync follows it. Resolve the real path and
    // require it to stay under the (best-effort) real bank root.
    let real: string
    try {
      real = realpathSync(abs)
    } catch {
      throw new Error(`file not found: ${path}`)
    }
    const root = bestRealpath(repoPath)
    if (real !== root && !real.startsWith(root + sep)) throw new Error(`invalid path: ${path}`)
    let raw = ''
    try {
      raw = readFileSync(abs, 'utf8')
    } catch {
      throw new Error(`file not found: ${path}`)
    }
    const truncated = raw.length > READ_FILE_LIMIT
    const meta = this.readMeta(repoPath)
    const idMatch = /^id:\s*(.+)$/m.exec(raw)
    return {
      path,
      content: truncated ? raw.slice(0, READ_FILE_LIMIT) : raw,
      truncated,
      edited: this.editedFiles(repoPath, meta).includes(path),
      ...(idMatch?.[1] ? { lessonId: idMatch[1].trim() } : {}),
    }
  }

  async listCommits(bankId: string, limit = DEFAULT_COMMIT_LIMIT): Promise<MemoryRepoCommit[]> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    const mode = await this.detectMode(repoPath)
    // A caller-supplied limit must be a positive integer; anything else (NaN,
    // negative, non-numeric, over the cap) is normalized so git never sees
    // `-nNaN`/`-n-3` and silently returns an empty history.
    const bounded = typeof limit === 'number' && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, MAX_COMMITS)
      : DEFAULT_COMMIT_LIMIT
    if (mode === 'snapshots') {
      // Entries chain parent→child, so one shared tree cache lets consecutive
      // diffs reuse both trees instead of re-walking every snapshot per entry.
      const treeCache = new Map<string, SnapshotFileRef[]>()
      const entries = readSnapshots(repoPath).slice(-bounded).reverse()
      return entries.map((entry) => {
        const files = snapshotDiff(repoPath, entry.parent, entry.id, treeCache).map((file) => ({
          path: file.path,
          op: file.op,
          additions: file.additions,
          deletions: file.deletions,
        }))
        return {
          sha: entry.id,
          parent: entry.parent,
          message: entry.message,
          ts: entry.ts,
          files,
          stats: commitStats(files),
        }
      })
    }
    const log = await this.runGit(repoPath, ['log', `-n${bounded}`, '--name-status', '--format=%x1e%H%x1f%P%x1f%cI%x1f%s'])
    if (!log.ok) return []
    return parseGitLog(log.stdout)
  }

  async commitDiff(bankId: string, sha: string): Promise<MemoryRepoCommitFile[]> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    const mode = await this.detectMode(repoPath)
    if (mode === 'snapshots') {
      const entry = readSnapshots(repoPath).find((candidate) => candidate.id === sha)
      if (!entry) throw new Error(`commit not found: ${sha}`)
      return snapshotDiff(repoPath, entry.parent, entry.id)
    }
    // Caller-supplied revision reaches git argv below — reject option-like values.
    assertRevision(sha)
    const nameStatus = await this.runGit(repoPath, ['show', '--name-status', '--format=', sha])
    const numstat = await this.runGit(repoPath, ['show', '--numstat', '--format=', sha])
    if (!nameStatus.ok) throw new Error(`commit not found: ${sha}`)
    const nums = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstat.stdout.split('\n')) {
      const [add, del, ...rest] = line.split('\t')
      const path = rest.join('\t')
      if (!path) continue
      nums.set(path, { additions: Number(add) || 0, deletions: Number(del) || 0 })
    }
    const files: MemoryRepoCommitFile[] = []
    for (const line of nameStatus.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const [status, ...rest] = trimmed.split('\t')
      const path = rest.join('\t')
      if (!path || !status) continue
      const numbers = nums.get(path) ?? { additions: 0, deletions: 0 }
      files.push({ path, op: opFromStatus(status), additions: numbers.additions, deletions: numbers.deletions })
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  async graph(bankId: string): Promise<MemoryRepoGraph> {
    bankId = this.canonicalBankId(bankId)
    const bundle = await this.provider.loadBundle(bankId)
    const rendered = renderRepoFiles(bundle, { generatedAt: this.nowProvider().toISOString() })
    const lessonFiles = new Map<string, RenderedRepoFile>()
    for (const file of rendered) if (file.kind === 'lesson' && file.lessonKey) lessonFiles.set(file.lessonKey, file)

    const nodes: MemoryRepoGraph['nodes'] = []
    const edges: MemoryRepoGraph['edges'] = []
    const seen = new Set<string>()
    const pushNode = (id: string, kind: MemoryRepoGraph['nodes'][number]['kind'], label: string, path?: string): void => {
      if (seen.has(id)) return
      seen.add(id)
      nodes.push({ id, kind, label, ...(path ? { path } : {}) })
    }
    for (const lesson of bundle.lessons) {
      const file = lessonFiles.get(lesson.lessonKey)
      const id = file ? lessonFileId(bundle, lesson) : lesson.lessonKey
      pushNode(id, 'lesson', lesson.rule, file?.path)
      for (const topic of [lesson.category, ...lesson.tags]) {
        if (!topic) continue
        const topicId = `topic:${topic}`
        pushNode(topicId, 'topic', topic)
        edges.push({ from: id, to: topicId, kind: 'cluster' })
      }
      if (lesson.source?.sessionId) {
        const sessionId = `session:${lesson.source.sessionId}`
        pushNode(sessionId, 'session', lesson.source.sessionId)
        edges.push({ from: id, to: sessionId, kind: 'provenance' })
      }
    }
    if (bundle.context) pushNode('context', 'context', 'Контекст')
    const memory = rendered.find((file) => file.kind === 'memory')
    if (memory) {
      pushNode('file:MEMORY.md', 'file', 'MEMORY.md', 'MEMORY.md')
      for (const match of memory.content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const target = match[1]!
        const file = [...lessonFiles.values()].find((candidate) => candidate.path.replace(/\.md$/, '') === target)
        if (file?.lessonId) edges.push({ from: 'file:MEMORY.md', to: file.lessonId, kind: 'wikilink' })
      }
    }
    return {
      nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
      edges: edges.sort((a, b) => `${a.from}\u0000${a.to}\u0000${a.kind}`.localeCompare(`${b.from}\u0000${b.to}\u0000${b.kind}`)),
    }
  }

  async exportZip(bankId: string): Promise<MemoryRepoExportResult> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    const entries: Array<{ path: string; data: Buffer }> = []
    for (const path of listRepoFiles(repoPath)) {
      const abs = safeJoin(repoPath, path)
      if (!abs || !existsSync(abs)) continue
      entries.push({ path, data: readFileSync(abs) })
    }
    const safeName = bankId.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const outPath = join(this.configDir, 'memory', 'exports', `${safeName}-${nowCompact(this.nowProvider())}.zip`)
    const bytes = writeStoredZip(entries, outPath)
    return { path: outPath, bytes }
  }

  /**
   * Write an auxiliary file (DREAMS.md). Never deletes or renders managed files.
   * Runs under the bank lock: it is a read-modify-write of `<repo>.meta.json`
   * that would otherwise race `materializeUnlocked` (it is never called from a
   * locked section, so there is no reentrancy).
   */
  async writeRepoFile(bankId: string, path: string, content: string): Promise<void> {
    bankId = this.canonicalBankId(bankId)
    await this.withLock(bankId, async () => {
      const repoPath = this.repoPathFor(bankId, '')
      const abs = safeJoin(repoPath, path)
      if (!abs) throw new Error(`invalid path: ${path}`)
      // Mirror readFile: refuse a target whose nearest existing ancestor's real
      // path escapes the bank root through a symlinked directory.
      const root = bestRealpath(repoPath)
      const ancestor = nearestExistingRealpath(dirname(abs))
      if (ancestor !== root && !ancestor.startsWith(root + sep)) throw new Error(`invalid path: ${path}`)
      writeFileAtomic(abs, content)
      const meta = this.readMeta(repoPath) ?? this.emptyMeta(bankId)
      meta.aux[path] = sha1Hex(content)
      meta.pendingAux[path] = true
      this.writeMeta(repoPath, meta)
    })
  }

  async materialize(bankId: string, reason: string): Promise<RepoMaterializeResult> {
    bankId = this.canonicalBankId(bankId)
    const result = await this.withLock(bankId, () => this.materializeUnlocked(bankId, reason))
    this.noteMaterialized(bankId, result, reason)
    return result
  }

  /**
   * Materialize a bank only when no projection has ever been recorded for it.
   * Owner-scoped banks (`main#<ownerKey8>` / `ws:<id>#<ownerKey8>`) have no RPC
   * write path that materializes, so the read handlers call this before serving
   * a bank's tree/status/commits. Lazy: no work when a projection exists; the
   * caller decides authorization and error handling.
   */
  async ensureMaterialized(bankId: string, reason = 'on-demand'): Promise<RepoMaterializeResult | null> {
    bankId = this.canonicalBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    if (this.readMeta(repoPath)?.writtenAt) return null
    return this.materialize(bankId, reason)
  }

  private emptyMeta(bankId: string): RepoMeta {
    return { version: 1, bankId, sourceRev: '', headOfMaterialize: null, writtenAt: '', files: {}, aux: {}, pendingAux: {}, edited: {}, uncommitted: {} }
  }

  private async materializeUnlocked(bankId: string, reason: string): Promise<RepoMaterializeResult> {
    const parsed = parseBankId(bankId)
    const repoPath = this.repoPathFor(bankId, '')
    mkdirSync(repoPath, { recursive: true })
    const mode = await this.detectMode(repoPath)
    const bundle = await this.provider.loadBundle(bankId)
    const rendered = renderRepoFiles(bundle, { generatedAt: this.nowProvider().toISOString() })
    const meta = this.readMeta(repoPath) ?? this.emptyMeta(bankId)
    const conflictsDir = join(repoPath, '.conflicts', nowCompact(this.nowProvider()))

    const nextFiles: Record<string, string> = {}
    const nextEdited: Record<string, true> = { ...meta.edited }
    const changed: string[] = []
    // Work-tree writes are collected here and flushed only after the write-ahead
    // `uncommitted` marker below — classification must finish before the first
    // byte lands so the marker can name exactly what is about to be written.
    const writes: Array<{ abs: string; path: string; content: string }> = []
    let addedLessons = 0
    let deletedLessons = 0

    for (const file of rendered) {
      const abs = safeJoin(repoPath, file.path)
      if (!abs) continue
      const newHash = sha1Hex(file.content)
      nextFiles[file.path] = newHash
      const disk = readDiskFile(abs)
      const recorded = meta.files[file.path]
      // Bytes we wrote in a batch that never committed are OURS, not a human
      // edit — even when the render changed since. Surface them for re-staging.
      const ours = disk.exists && meta.uncommitted[file.path] !== undefined && disk.hash === meta.uncommitted[file.path]
      if (disk.exists && !ours && (recorded === undefined || disk.hash !== recorded)) {
        // Human edit (or an out-of-band file at a managed path): never overwrite.
        if (disk.hash !== newHash) {
          // Copy the artifact once per suspended file — an unresolved edit must
          // not mint a fresh `.conflicts/<ts>/` copy on every materialize.
          if (meta.edited[file.path] !== true) this.copyConflict(conflictsDir, file.path, abs)
          nextEdited[file.path] = true
          continue
        }
      }
      if (disk.exists && disk.hash === newHash) {
        if (recorded !== undefined) delete nextEdited[file.path]
        // Disk matches the render but the recorded hash is stale (a failed
        // batch, or an identical out-of-band file): must be staged again.
        if (recorded !== newHash) changed.push(file.path)
        continue
      }
      writes.push({ abs, path: file.path, content: file.content })
      if (recorded === undefined && file.kind === 'lesson') addedLessons++
      delete nextEdited[file.path]
      changed.push(file.path)
    }

    for (const path of Object.keys(meta.files).sort()) {
      if (nextFiles[path] !== undefined) continue
      const abs = safeJoin(repoPath, path)
      if (!abs) continue
      const disk = readDiskFile(abs)
      if (!disk.exists) {
        delete nextEdited[path]
        // The recorded file is gone: stage the deletion (also re-stages a
        // deletion whose batch failed).
        changed.push(path)
        continue
      }
      // Our own abandoned write (the render dropped the path since the failed
      // batch): delete it and stage the deletion, never quarantine.
      if (meta.uncommitted[path] !== undefined && disk.hash === meta.uncommitted[path]) {
        unlinkSync(abs)
        if (path.startsWith('lessons/')) deletedLessons++
        delete nextEdited[path]
        changed.push(path)
        continue
      }
      if (disk.hash !== meta.files[path]) {
        if (meta.edited[path] !== true) this.copyConflict(conflictsDir, path, abs)
        nextEdited[path] = true
        continue
      }
      unlinkSync(abs)
      if (path.startsWith('lessons/')) deletedLessons++
      delete nextEdited[path]
      changed.push(path)
    }

    // Auxiliary files (DREAMS.md) pending from writeRepoFile join this batch.
    for (const path of Object.keys(meta.pendingAux ?? {}).sort()) {
      const abs = safeJoin(repoPath, path)
      if (abs && existsSync(abs) && !changed.includes(path)) changed.push(path)
    }

    // Write-ahead marker: classify first, then record — BEFORE the first
    // work-tree write — the sha1 of the bytes this batch is about to write. If
    // the process dies between that write and the commit, the next materialize
    // recognizes those bytes as ours (re-stages them, never quarantines them)
    // even when the render has changed, and it never mistakes a genuine human
    // edit (which does not match the marker) for our own output. `files` is
    // deliberately left untouched: it advances only when a batch lands.
    if (writes.length > 0) {
      const seededUncommitted: Record<string, string> = { ...meta.uncommitted }
      for (const write of writes) seededUncommitted[write.path] = sha1Hex(write.content)
      this.writeMeta(repoPath, { ...meta, uncommitted: seededUncommitted })
    }
    for (const write of writes) writeFileAtomic(write.abs, write.content)

    const sourceRev = projectionRev(rendered)
    let committed = false
    let head = meta.headOfMaterialize
    // A batch is "landed" when there was nothing to stage or the commit
    // succeeded. On a failed stage/commit the recorded hashes are rolled back
    // so the same paths stay committable and are re-staged next run.
    let batchLanded = true
    let nextUncommitted: Record<string, string> = {}
    let failure: string | undefined

    if (changed.length > 0) {
      if (mode === 'git') {
        const staged = await this.runGit(repoPath, ['add', '-A', '--', ...changed])
        if (!staged.ok) {
          batchLanded = false
          failure = staged.stderr.trim() || `exit ${staged.code ?? 'unknown'}`
          console.warn(`[memory-repo] git add failed for ${bankId}: ${failure}`)
        } else {
          const pending = await this.runGit(repoPath, ['diff', '--cached', '--name-only'])
          if (!pending.ok) {
            batchLanded = false
            failure = pending.stderr.trim() || `exit ${pending.code ?? 'unknown'}`
            console.warn(`[memory-repo] git diff --cached failed for ${bankId}: ${failure}`)
          } else {
            // `git commit` commits the WHOLE index, so an entry this batch did
            // not stage (an orphan from a killed batch, e.g. a file since
            // classified as a human edit) must be unstaged first.
            const changedSet = new Set(changed)
            const extras = pending.stdout
              .split('\n')
              .map((line) => line.trim())
              .filter((path) => path.length > 0 && !changedSet.has(path))
            let stagedOutput = pending.stdout
            if (extras.length > 0) {
              const unstaged = await this.unstagePaths(repoPath, extras)
              if (!unstaged.ok) {
                batchLanded = false
                failure = unstaged.stderr.trim() || `exit ${unstaged.code ?? 'unknown'}`
                console.warn(`[memory-repo] git unstage failed for ${bankId}: ${failure}`)
              } else {
                const remaining = await this.runGit(repoPath, ['diff', '--cached', '--name-only'])
                if (!remaining.ok) {
                  batchLanded = false
                  failure = remaining.stderr.trim() || `exit ${remaining.code ?? 'unknown'}`
                  console.warn(`[memory-repo] git diff --cached failed for ${bankId}: ${failure}`)
                } else {
                  stagedOutput = remaining.stdout
                }
              }
            }
            if (batchLanded && stagedOutput.trim()) {
              const message = commitMessage(parsed.scope, reason, { addedLessons, deletedLessons })
              const commit = await this.runGit(repoPath, ['commit', '-q', '-m', message])
              if (commit.ok) {
                committed = true
                head = (await this.revParseHead(repoPath)) ?? head
              } else {
                batchLanded = false
                failure = commit.stderr.trim() || `exit ${commit.code ?? 'unknown'}`
                console.warn(`[memory-repo] git commit failed for ${bankId}: ${failure}`)
              }
            }
          }
        }
      } else {
        const snapshot = createSnapshot(repoPath, { message: `memory(${parsed.scope}): ${reason}`, now: this.nowProvider() })
        // Keep `head` on the existing entry when the tree already matches it;
        // an unchanged retry is a no-op (mirrors git mode's nothing-to-commit).
        head = snapshot.entry.id
        committed = snapshot.appended
      }
    }

    if (!batchLanded) {
      // Invariant: `meta.files` advances to a batch's written bytes only after
      // that batch commits. A failed batch rolls the recorded hashes back to
      // their previous values and remembers, in `meta.uncommitted`, the sha1 of
      // every path's on-disk bytes it left behind — so the next materialize
      // recognizes those bytes as ours (re-stages them, never quarantines them),
      // regardless of how the render changed, and clears the marker once the
      // batch lands.
      nextUncommitted = { ...meta.uncommitted }
      for (const path of changed) {
        const abs = safeJoin(repoPath, path)
        const disk = abs ? readDiskFile(abs) : { exists: false, hash: '' }
        if (disk.exists) nextUncommitted[path] = disk.hash
        else delete nextUncommitted[path]
        const previous = meta.files[path]
        if (previous !== undefined) nextFiles[path] = previous
        else delete nextFiles[path]
      }
    }

    this.writeMeta(repoPath, {
      version: 1,
      bankId,
      sourceRev,
      headOfMaterialize: head,
      writtenAt: this.nowProvider().toISOString(),
      files: nextFiles,
      aux: meta.aux,
      // A failed batch keeps its pending auxiliary paths so they are re-staged.
      pendingAux: batchLanded ? {} : (meta.pendingAux ?? {}),
      edited: nextEdited,
      uncommitted: nextUncommitted,
    })

    const editedFiles = Object.keys(nextEdited).sort()
    this.noteEditedFiles(bankId, editedFiles)
    return {
      committed,
      ...(committed && head ? { sha: head } : {}),
      files: changed.length,
      edited: editedFiles,
      ...(failure ? { error: failure } : {}),
    }
  }

  /**
   * Unstage index entries this batch did not stage. `git reset -- <paths>`
   * restores each entry to HEAD — the right move for a tracked file whose
   * staged change is not ours — but a pre-2.x git refuses it on an unborn HEAD;
   * there every staged entry is a new file, so `git rm --cached` fits.
   */
  private async unstagePaths(repoPath: string, paths: string[]): Promise<GitExecResult> {
    const reset = await this.runGit(repoPath, ['reset', '-q', '--', ...paths])
    if (reset.ok) return reset
    return this.runGit(repoPath, ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--quiet', '--', ...paths])
  }

  private copyConflict(conflictsDir: string, path: string, abs: string): void {
    const target = join(conflictsDir, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    try {
      writeFileSync(target, readFileSync(abs))
    } catch {
      // the conflict copy is best-effort; refusing to overwrite is the hard guarantee
    }
  }

  notifyMutation(bank: RepoBankRef, reason: string): void {
    if (this.disposed) return
    const bankId = formatBankId(bank.scope, bank.scope === 'workspace' ? bank.workspaceId : undefined, bank.ownerKey8)
    this.pendingReason.set(bankId, reason)
    clearTimeout(this.timers.get(bankId))
    const timer = setTimeout(() => {
      this.timers.delete(bankId)
      const pending = this.pendingReason.get(bankId) ?? reason
      this.pendingReason.delete(bankId)
      void this.materialize(bankId, pending).catch(() => {})
    }, this.debounceMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.timers.set(bankId, timer)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pendingReason.clear()
    await Promise.allSettled([...this.locks.values()])
  }
}

function projectionRev(rendered: RenderedRepoFile[]): string {
  const canonical = rendered
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}\u0000${sha1Hex(file.content)}`)
    .join('\n')
  return sha1Hex(canonical)
}

function commitMessage(scope: 'main' | 'workspace', reason: string, counts: { addedLessons: number; deletedLessons: number }): string {
  const delta = counts.addedLessons || counts.deletedLessons ? ` [+${counts.addedLessons}/-${counts.deletedLessons} уроков]` : ''
  const trailers = [
    `Rox-Dream: ${reason === 'dream' ? 'true' : 'false'}`,
    'Rox-Session: -',
    `Rox-Trigger: ${reason}`,
  ].join('\n')
  return `memory(${scope}): ${reason}${delta}\n\n${trailers}`
}

function opFromStatus(status: string): 'added' | 'modified' | 'deleted' {
  const letter = status[0]
  if (letter === 'A') return 'added'
  if (letter === 'D') return 'deleted'
  return 'modified'
}

function commitStats(files: MemoryRepoCommitFile[]): { added: number; modified: number; deleted: number } {
  let added = 0
  let modified = 0
  let deleted = 0
  for (const file of files) {
    if (file.op === 'added') added++
    else if (file.op === 'deleted') deleted++
    else modified++
  }
  return { added, modified, deleted }
}

/** Parse `git log --name-status --format=%x1e%H%x1f%P%x1f%cI%x1f%s`. */
function parseGitLog(stdout: string): MemoryRepoCommit[] {
  const commits: MemoryRepoCommit[] = []
  for (const record of stdout.split('\x1e')) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const lines = trimmed.split('\n')
    const [sha = '', parent = '', ts = '', ...subjectParts] = (lines.shift() ?? '').split('\x1f')
    if (!sha) continue
    const files: MemoryRepoCommitFile[] = []
    for (const line of lines) {
      const entry = line.trim()
      if (!entry) continue
      const [status, ...rest] = entry.split('\t')
      const path = rest.join('\t')
      if (!path || !status) continue
      files.push({ path, op: opFromStatus(status), additions: 0, deletions: 0 })
    }
    commits.push({
      sha,
      parent: parent.trim() ? parent.trim().split(' ')[0]! : null,
      message: subjectParts.join('\x1f'),
      ts,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      stats: commitStats(files),
    })
  }
  return commits
}