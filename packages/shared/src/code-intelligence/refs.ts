/** Local repository contracts. Captured bytes are immutable and never sent to a provider here. */
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { isSafeToIngest } from './local-adapter.ts'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 256 * 1024
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MAX_FILES = 10_000
const MAX_RECORD_BYTES = 32 * 1024 * 1024
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export class RepositoryContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'RepositoryContractError'
  }
}

export interface RepositoryScope { workspaceId: string; projectId: string }

export interface ProviderPolicy {
  readonly id: string
  readonly workspaceId: string
  readonly allowedRoots: readonly string[]
  readonly includes?: readonly string[]
  readonly approvedBranch?: string
  readonly excludes: readonly string[]
  readonly dataEgress: 'deny' | 'allow'
  readonly maxFileBytes: number
  readonly maxBytes: number
  readonly maxFiles: number
}

export interface ProviderPolicyInput {
  id?: string
  workspaceId: string
  allowedRoots: readonly string[]
  includes?: readonly string[]
  approvedBranch?: string
  excludes?: readonly string[]
  dataEgress?: 'deny' | 'allow'
  maxFileBytes?: number
  maxBytes?: number
  maxFiles?: number
}

export interface RepositoryBinding {
  readonly schemaVersion: 1
  readonly id: string
  /** A canonical repository is independent of the project and provider. */
  readonly repositoryId: string
  readonly workspaceId: string
  readonly projectId: string
  readonly sourceId?: string
  readonly canonicalRoot: string
  readonly providerPolicyId: string
  readonly policy: ProviderPolicy
  readonly createdAt: number
}

export type SourceVersion =
  | { readonly kind: 'git-commit'; readonly value: string }
  | { readonly kind: 'working-copy'; readonly value: string }

export interface SnapshotSourceFile {
  readonly id: string
  readonly snapshotId: string
  readonly path: string
  readonly content: string
  readonly contentHash: string
  readonly bytes: number
  readonly mode: '100644' | '100755'
  readonly blobSha: string
  readonly parentBlobSha?: string
  /** Present only when these exact bytes exist at the verified parent commit. */
  readonly commitSha?: string
  readonly sourceVersion: SourceVersion
}

export type SnapshotSkipReason = 'excluded' | 'symlink' | 'submodule' | 'missing' | 'not-file'
  | 'file-byte-limit' | 'snapshot-byte-limit' | 'secret' | 'binary'

export interface RepositorySnapshot {
  readonly schemaVersion: 1
  readonly id: string
  readonly bindingId: string
  readonly repositoryId: string
  readonly workspaceId: string
  readonly projectId: string
  readonly parentCommitSha: string
  readonly treeSha: string
  readonly objectFormat: 'sha1' | 'sha256'
  readonly dirty: boolean
  readonly dirtyWorkingCopyDigest?: string
  readonly capturedAt: number
  readonly includedPathsHash: string
  readonly policyHash: string
  readonly files: readonly SnapshotSourceFile[]
  readonly skipped: readonly { readonly path: string; readonly reason: SnapshotSkipReason }[]
  readonly coverage: { readonly includedCount: number; readonly skippedCount: number; readonly totalPaths: number; readonly truncated: boolean }
}

export type RepositorySnapshotSummary = Omit<RepositorySnapshot, 'files'> & {
  readonly files: readonly Omit<SnapshotSourceFile, 'content'>[]
}
export interface RepositoryProjectInput { workspaceId: string; projectId: string; requestId?: string }
export interface RepositorySnapshotInput extends RepositoryProjectInput { snapshotId: string; policyHash?: string }
export interface RepositoryReadSpanInput extends RepositorySnapshotInput { path: string; startLine: number; endLine: number }
export interface RepositoryInspection { readonly binding: RepositoryBinding | null; readonly snapshots: readonly RepositorySnapshotSummary[] }
export type RepositoryFreshness = { state: 'current' | 'stale' | 'unavailable'; currentSnapshotId?: string; reason?: string }

/** Renderer-safe metadata; captured file bodies leave the host only through bounded reads. */
export function summarizeRepositorySnapshot(snapshot: RepositorySnapshot): RepositorySnapshotSummary {
  validateRepositorySnapshot(snapshot)
  return frozen({ ...snapshot, files: snapshot.files.map(({ content: _content, ...metadata }) => metadata) })
}

export interface FileSpan {
  readonly id: string
  readonly fileId: string
  readonly snapshotId: string
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly contentHash: string
  readonly excerpt: string
  readonly sourceVersion: SourceVersion
}

export interface RepositoryRef extends RepositoryScope {
  readonly version: 1
  readonly kind: 'snapshot' | 'file' | 'span'
  readonly repositoryId: string
  readonly bindingId: string
  readonly snapshotId: string
  readonly path?: string
  readonly startLine?: number
  readonly endLine?: number
}

function fail(code: string): never { throw new RepositoryContractError(code) }
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
function digest(value: unknown): string { return sha256(JSON.stringify(value)) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-record')
  return value as Record<string, unknown>
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid-identifier')
  return value
}
function recordId(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !HASH.test(value.slice(prefix.length))) fail('invalid-record-id')
  return value
}
function boundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('invalid-limit')
  return value as number
}
function timestamp(value: unknown): number { return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER) }
function absolutePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value) || !isAbsolute(value)) fail('invalid-root')
  return resolve(value)
}
export function normalizeRepositoryPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f]/.test(value) || isAbsolute(value)) fail('invalid-path')
  if (value.split('/').some(part => !part || part === '.' || part === '..')) fail('invalid-path')
  return value
}
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(child => frozen(child))
    Object.freeze(value)
  }
  return value
}
function exclusion(value: unknown): string {
  if (typeof value !== 'string') fail('invalid-exclusion')
  const normalized = value.replace(/\/$/, '')
  if (!normalized || normalized.length > 512 || /[\\\x00-\x1f]/.test(normalized)
    || normalized.startsWith('/') || normalized.split('/').some(p => p === '..' || p === '.' || !p)) fail('invalid-exclusion')
  return normalized
}
function normalizePolicy(input: ProviderPolicyInput): ProviderPolicy {
  identifier(input.workspaceId)
  if (!Array.isArray(input.allowedRoots) || !input.allowedRoots.length || input.allowedRoots.length > 64) fail('invalid-roots')
  if (input.excludes && (!Array.isArray(input.excludes) || input.excludes.length > 128)) fail('invalid-exclusions')
  if (input.includes && (!Array.isArray(input.includes) || !input.includes.length || input.includes.length > 128)) fail('invalid-includes')
  if (input.approvedBranch !== undefined && (typeof input.approvedBranch !== 'string' || !input.approvedBranch || input.approvedBranch.length > 255 || /[\x00-\x20~^:?*\[\\]/.test(input.approvedBranch))) fail('invalid-branch')
  const allowedRoots = [...new Set(input.allowedRoots.map(absolutePath))].sort()
  const excludes = [...new Set((input.excludes ?? []).map(exclusion))].sort()
  if (input.dataEgress !== undefined && input.dataEgress !== 'deny' && input.dataEgress !== 'allow') fail('invalid-egress-policy')
  const normalized = {
    workspaceId: input.workspaceId, allowedRoots, excludes,
    ...(input.includes === undefined ? {} : { includes: [...new Set(input.includes.map(exclusion))].sort() }),
    ...(input.approvedBranch === undefined ? {} : { approvedBranch: input.approvedBranch }),
    dataEgress: input.dataEgress ?? 'deny' as const,
    maxFileBytes: boundedInteger(input.maxFileBytes ?? MAX_FILE_BYTES, 1, MAX_FILE_BYTES),
    maxBytes: boundedInteger(input.maxBytes ?? MAX_SNAPSHOT_BYTES, 1, MAX_SNAPSHOT_BYTES),
    maxFiles: boundedInteger(input.maxFiles ?? MAX_FILES, 1, MAX_FILES),
  }
  return frozen({ id: input.id ? identifier(input.id) : `policy_${digest(normalized)}`, ...normalized })
}
export function repositoryPolicyFingerprint(policy: ProviderPolicy): string {
  return digest(normalizePolicy(policy))
}
export function assertRepositoryScope(binding: RepositoryBinding, scope: RepositoryScope): void {
  identifier(scope.workspaceId); identifier(scope.projectId)
  if (binding.workspaceId !== scope.workspaceId || binding.projectId !== scope.projectId) fail('scope-denied')
}
function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) fail('request-cancelled')
}
async function git(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  checkCancellation(signal)
  try {
    const result = await execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 10_000, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' },
    })
    return result.stdout
  } catch { checkCancellation(signal); return fail('git-unavailable-or-invalid-repository') }
}
export async function resolveRepositoryGitRoot(workingDirectory: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  checkCancellation(options.signal)
  const path = absolutePath(workingDirectory)
  let canonical: string
  try { canonical = await realpath(path) } catch { return fail('root-missing') }
  const root = (await git(canonical, ['rev-parse', '--show-toplevel'], options.signal)).trim()
  if (!root) fail('not-a-git-repository')
  try { return await realpath(absolutePath(root)) } catch { return fail('root-missing') }
}
async function enforceLiveRoot(binding: RepositoryBinding, signal?: AbortSignal): Promise<void> {
  const root = await resolveRepositoryGitRoot(binding.canonicalRoot, { signal })
  if (root !== binding.canonicalRoot) fail('root-changed')
  const allowed = await Promise.all(binding.policy.allowedRoots.map(async p => {
    try { return await realpath(p) } catch { return fail('allowed-root-missing') }
  }))
  if (!allowed.some(p => within(p, root))) fail('root-denied')
  if (binding.policy.approvedBranch !== undefined && (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)).trim() !== binding.policy.approvedBranch) fail('repository-branch-changed')
}

export async function bindRepository(input: RepositoryScope & {
  workingDirectory: string; sourceId?: string; policy: ProviderPolicyInput; now?: number; signal?: AbortSignal
}): Promise<RepositoryBinding> {
  checkCancellation(input.signal)
  identifier(input.workspaceId); identifier(input.projectId)
  if (input.sourceId !== undefined) identifier(input.sourceId)
  if (input.policy.workspaceId !== input.workspaceId) fail('scope-denied')
  normalizePolicy(input.policy)
  const root = await resolveRepositoryGitRoot(input.workingDirectory, { signal: input.signal })
  const canonicalAllowedRoots = await Promise.all(input.policy.allowedRoots.map(async p => {
    try { return await realpath(absolutePath(p)) } catch { return fail('allowed-root-missing') }
  }))
  const policy = normalizePolicy({ ...input.policy, allowedRoots: canonicalAllowedRoots })
  if (!policy.allowedRoots.some(p => within(p, root))) fail('root-denied')
  const repositoryId = `repo_${digest(root)}`
  const id = `binding_${digest([input.workspaceId, input.projectId, repositoryId, input.sourceId ?? null])}`
  return frozen({ schemaVersion: 1, id, repositoryId, workspaceId: input.workspaceId,
    projectId: input.projectId, ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    canonicalRoot: root, providerPolicyId: policy.id, policy, createdAt: timestamp(input.now ?? Date.now()) })
}

function matchesExclude(path: string, pattern: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return path === pattern || path.startsWith(`${pattern}/`)
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '*' && pattern[i + 1] === '*') {
      i++
      if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?' } else source += '.*'
    } else if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`).test(path)
}
export function isRepositoryPathExcluded(path: string, policy: ProviderPolicy): boolean {
  normalizeRepositoryPath(path)
  if (path.split('/').some(p => p === '.git' || p === 'node_modules')) return true
  return Boolean(policy.includes && !policy.includes.some(pattern => matchesExclude(path, pattern))) || policy.excludes.some(pattern => matchesExclude(path, pattern))
}
function blobHash(content: Buffer, objectFormat: 'sha1' | 'sha256'): string {
  return createHash(objectFormat).update(`blob ${content.byteLength}\0`).update(content).digest('hex')
}
async function safeBytes(root: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<
  { bytes: Buffer; mode: '100644' | '100755'; stamp: string } | { reason: SnapshotSkipReason }
> {
  const parts = path.split('/')
  let cursor = root
  for (const part of parts) {
    checkCancellation(signal)
    cursor = resolve(cursor, part)
    if (!within(root, cursor)) fail('path-escape')
    try { if ((await lstat(cursor)).isSymbolicLink()) return { reason: 'symlink' } }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { reason: 'missing' }; throw e }
  }
  if (!within(root, await realpath(cursor))) fail('path-escape')
  const handle = await open(cursor, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) return { reason: 'not-file' }
    if (before.size > BigInt(maxBytes)) return { reason: 'file-byte-limit' }
    // A growing file must not make readFile allocate beyond the policy limit.
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      checkCancellation(signal)
      const chunk = await handle.read(buffer, length, buffer.length - length, null)
      if (!chunk.bytesRead) break
      length += chunk.bytesRead
    }
    const bytes = buffer.subarray(0, length)
    const after = await handle.stat({ bigint: true })
    if (stamp(before) !== stamp(after) || bytes.byteLength !== Number(after.size)) fail('source-changed-during-capture')
    if (bytes.byteLength > maxBytes) return { reason: 'file-byte-limit' }
    // O_NOFOLLOW protects the final component; verify ancestors and the opened inode too.
    if (!within(root, await realpath(cursor))) fail('path-escape')
    let checkedPath = root
    for (const part of parts) {
      checkedPath = resolve(checkedPath, part)
      if ((await lstat(checkedPath)).isSymbolicLink()) fail('source-changed-during-capture')
    }
    const pathStat = await lstat(cursor, { bigint: true })
    if (pathStat.dev !== after.dev || pathStat.ino !== after.ino) fail('source-changed-during-capture')
    return { bytes, mode: before.mode & 0o111n ? '100755' : '100644', stamp: stamp(after) }
  } finally { await handle.close() }
}
function stamp(s: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; mode: bigint }): string {
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode].join(':')
}
function sourceManifest(snapshot: Pick<RepositorySnapshot, 'files' | 'skipped'>): unknown {
  return [snapshot.files.map(f => [f.path, f.contentHash, f.bytes, f.mode, f.blobSha, f.parentBlobSha ?? null, f.commitSha ?? null]),
    snapshot.skipped.map(s => [s.path, s.reason])]
}
function snapshotIdentity(snapshot: Omit<RepositorySnapshot, 'id'> | RepositorySnapshot): string {
  return `snapshot_${digest([snapshot.bindingId, snapshot.repositoryId, snapshot.parentCommitSha, snapshot.treeSha,
    snapshot.objectFormat, snapshot.dirty, snapshot.dirtyWorkingCopyDigest ?? null,
    snapshot.policyHash, snapshot.includedPathsHash, sourceManifest(snapshot)])}`
}

export async function captureRepositorySnapshot(binding: RepositoryBinding, options: {
  scope: RepositoryScope; now?: number; signal?: AbortSignal
}): Promise<RepositorySnapshot> {
  checkCancellation(options.signal)
  validateRepositoryBinding(binding); assertRepositoryScope(binding, options.scope)
  await enforceLiveRoot(binding, options.signal)
  checkCancellation(options.signal)
  const root = binding.canonicalRoot
  const parentCommitSha = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], options.signal)).trim()
  const treeSha = (await git(root, ['rev-parse', '--verify', 'HEAD^{tree}'], options.signal)).trim()
  if (!SHA.test(parentCommitSha) || !SHA.test(treeSha)) fail('invalid-git-identity')
  const format = (await git(root, ['rev-parse', '--show-object-format'], options.signal)).trim()
  if (format !== 'sha1' && format !== 'sha256') fail('unsupported-git-object-format')
  const objectFormat = format
  const beforeStatus = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options.signal)
  const tree = await git(root, ['ls-tree', '-r', '-z', '--full-tree', parentCommitSha], options.signal)
  const baseline = new Map<string, { mode: string; sha: string }>()
  for (const entry of tree.split('\0').filter(Boolean)) {
    const match = /^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry)
    if (!match || !SHA.test(match[2]!)) fail('invalid-git-tree')
    baseline.set(normalizeRepositoryPath(match[3]), { mode: match[1]!, sha: match[2]! })
  }
  const listed = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], options.signal)
  const paths = [...new Set(listed.split('\0').filter(Boolean).map(normalizeRepositoryPath))].sort()
  if (paths.length > binding.policy.maxFiles) fail('file-count-limit')
  const files: Omit<SnapshotSourceFile, 'snapshotId'>[] = []
  const skipped: { path: string; reason: SnapshotSkipReason }[] = []
  const stamps = new Map<string, string>()
  let totalBytes = 0
  for (const path of paths) {
    checkCancellation(options.signal)
    if (isRepositoryPathExcluded(path, binding.policy)) { skipped.push({ path, reason: 'excluded' }); continue }
    const parent = baseline.get(path)
    if (parent?.mode === '160000') { skipped.push({ path, reason: 'submodule' }); continue }
    const result = await safeBytes(root, path, binding.policy.maxFileBytes, options.signal)
    if ('reason' in result) { skipped.push({ path, reason: result.reason }); continue }
    stamps.set(path, result.stamp)
    const content = result.bytes.toString('utf8')
    if (content.includes('\0') || !Buffer.from(content).equals(result.bytes)) { skipped.push({ path, reason: 'binary' }); continue }
    if (!isSafeToIngest({ path, content, commit: parentCommitSha })) { skipped.push({ path, reason: 'secret' }); continue }
    if (totalBytes + result.bytes.byteLength > binding.policy.maxBytes) { skipped.push({ path, reason: 'snapshot-byte-limit' }); continue }
    totalBytes += result.bytes.byteLength
    const contentHash = sha256(result.bytes)
    const blobSha = blobHash(result.bytes, objectFormat)
    const commitSha = parent?.sha === blobSha ? parentCommitSha : undefined
    const sourceVersion: SourceVersion = commitSha
      ? { kind: 'git-commit', value: commitSha } : { kind: 'working-copy', value: contentHash }
    files.push({ id: `file_${digest([binding.repositoryId, path, contentHash])}`, path, content,
      contentHash, bytes: result.bytes.byteLength, mode: result.mode, blobSha,
      ...(parent ? { parentBlobSha: parent.sha } : {}), ...(commitSha ? { commitSha } : {}), sourceVersion })
  }
  for (const [path, recorded] of stamps) {
    checkCancellation(options.signal)
    try { if (stamp(await lstat(resolve(root, path), { bigint: true })) !== recorded) fail('source-changed-during-capture') }
    catch { fail('source-changed-during-capture') }
  }
  const afterCommit = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], options.signal)).trim()
  if (afterCommit !== parentCommitSha || await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options.signal) !== beforeStatus) fail('source-changed-during-capture')
  // Git's assume-unchanged/skip-worktree flags can hide modified bytes from status.
  const dirty = beforeStatus.length > 0 || files.some(f => !f.commitSha || baseline.get(f.path)?.mode !== f.mode)
    || skipped.some(s => baseline.has(s.path) && ['missing', 'not-file'].includes(s.reason))
  const manifest = { files: files as SnapshotSourceFile[], skipped }
  const base: Omit<RepositorySnapshot, 'id'> = { schemaVersion: 1, bindingId: binding.id, repositoryId: binding.repositoryId,
    workspaceId: binding.workspaceId, projectId: binding.projectId, parentCommitSha, treeSha, objectFormat,
    dirty, ...(dirty ? { dirtyWorkingCopyDigest: digest(sourceManifest(manifest)) } : {}),
    capturedAt: timestamp(options.now ?? Date.now()), includedPathsHash: digest(files.map(f => f.path)),
    policyHash: repositoryPolicyFingerprint(binding.policy), files: files as SnapshotSourceFile[], skipped,
    coverage: { includedCount: files.length, skippedCount: skipped.length, totalPaths: paths.length,
      truncated: skipped.some(s => s.reason === 'file-byte-limit' || s.reason === 'snapshot-byte-limit') } }
  const id = snapshotIdentity(base)
  return frozen({ ...base, id, files: files.map(file => ({ ...file, snapshotId: id })) })
}

export function validateRepositoryBinding(input: unknown): RepositoryBinding {
  const value = object(input)
  if (value.schemaVersion !== 1) fail('unsupported-record-version')
  const workspaceId = identifier(value.workspaceId), projectId = identifier(value.projectId)
  const canonical = absolutePath(value.canonicalRoot)
  const policy = normalizePolicy(object(value.policy) as unknown as ProviderPolicyInput)
  if (policy.workspaceId !== workspaceId || value.providerPolicyId !== policy.id) fail('invalid-policy-binding')
  const repositoryId = recordId(value.repositoryId, 'repo_')
  if (repositoryId !== `repo_${digest(canonical)}`) fail('invalid-repository-identity')
  const sourceId = value.sourceId === undefined ? undefined : identifier(value.sourceId)
  const id = recordId(value.id, 'binding_')
  if (id !== `binding_${digest([workspaceId, projectId, repositoryId, sourceId ?? null])}`) fail('invalid-binding-identity')
  if (!policy.allowedRoots.some(root => within(root, canonical))) fail('root-denied')
  return frozen({ schemaVersion: 1, id, repositoryId, workspaceId, projectId,
    ...(sourceId ? { sourceId } : {}), canonicalRoot: canonical, policy, providerPolicyId: policy.id, createdAt: timestamp(value.createdAt) })
}

export function validateRepositorySnapshot(input: unknown): RepositorySnapshot {
  const value = object(input)
  if (value.schemaVersion !== 1) fail('unsupported-record-version')
  recordId(value.id, 'snapshot_'); recordId(value.bindingId, 'binding_'); recordId(value.repositoryId, 'repo_')
  identifier(value.workspaceId); identifier(value.projectId); timestamp(value.capturedAt)
  if (!SHA.test(String(value.parentCommitSha)) || !SHA.test(String(value.treeSha)) || !HASH.test(String(value.policyHash))
    || !HASH.test(String(value.includedPathsHash)) || typeof value.dirty !== 'boolean'
    || (value.objectFormat !== 'sha1' && value.objectFormat !== 'sha256')) fail('invalid-snapshot')
  if (!Array.isArray(value.files) || !Array.isArray(value.skipped) || value.files.length + value.skipped.length > MAX_FILES) fail('invalid-snapshot-files')
  let bytes = 0
  const seen = new Set<string>()
  for (const raw of value.files) {
    const f = object(raw), path = normalizeRepositoryPath(f.path)
    if (seen.has(path)) fail('duplicate-snapshot-path'); seen.add(path)
    if (typeof f.content !== 'string' || f.content.includes('\0')) fail('invalid-snapshot-content')
    const content = Buffer.from(f.content)
    bytes += content.byteLength
    if (content.byteLength > MAX_FILE_BYTES || bytes > MAX_SNAPSHOT_BYTES || f.bytes !== content.byteLength || f.contentHash !== sha256(content)) fail('invalid-snapshot-content')
    if (f.id !== `file_${digest([value.repositoryId, path, f.contentHash])}` || f.snapshotId !== value.id
      || f.blobSha !== blobHash(content, value.objectFormat) || (f.mode !== '100644' && f.mode !== '100755')) fail('invalid-snapshot-file')
    if (f.parentBlobSha !== undefined && !SHA.test(String(f.parentBlobSha))) fail('invalid-parent-blob')
    const version = object(f.sourceVersion)
    if (f.commitSha !== undefined) {
      if (f.commitSha !== value.parentCommitSha || f.parentBlobSha !== f.blobSha || version.kind !== 'git-commit' || version.value !== f.commitSha) fail('false-commit-citation')
    } else if (version.kind !== 'working-copy' || version.value !== f.contentHash) fail('invalid-source-version')
  }
  const reasons = new Set<SnapshotSkipReason>(['excluded', 'symlink', 'submodule', 'missing', 'not-file', 'file-byte-limit', 'snapshot-byte-limit', 'secret', 'binary'])
  for (const raw of value.skipped) {
    const s = object(raw), path = normalizeRepositoryPath(s.path)
    if (seen.has(path) || !reasons.has(s.reason as SnapshotSkipReason)) fail('invalid-snapshot-skip')
    seen.add(path)
  }
  const snapshot = value as unknown as RepositorySnapshot
  if (value.includedPathsHash !== digest(snapshot.files.map(f => f.path))
    || value.id !== snapshotIdentity(snapshot)
    || (value.dirty ? value.dirtyWorkingCopyDigest !== digest(sourceManifest(snapshot)) : value.dirtyWorkingCopyDigest !== undefined)) fail('invalid-snapshot-identity')
  const coverage = object(value.coverage)
  if (coverage.includedCount !== snapshot.files.length || coverage.skippedCount !== snapshot.skipped.length
    || coverage.totalPaths !== seen.size || coverage.truncated !== snapshot.skipped.some(s => s.reason === 'file-byte-limit' || s.reason === 'snapshot-byte-limit')) fail('invalid-coverage')
  return frozen(snapshot)
}
export function assertRepositorySnapshotScope(snapshot: RepositorySnapshot, binding: RepositoryBinding, scope: RepositoryScope): void {
  validateRepositoryBinding(binding); assertRepositoryScope(binding, scope)
  validateRepositorySnapshot(snapshot)
  if (snapshot.bindingId !== binding.id || snapshot.repositoryId !== binding.repositoryId
    || snapshot.workspaceId !== scope.workspaceId || snapshot.projectId !== scope.projectId) fail('scope-denied')
  if (snapshot.policyHash !== repositoryPolicyFingerprint(binding.policy)) fail('snapshot-policy-changed')
  if (snapshot.coverage.totalPaths > binding.policy.maxFiles || snapshot.files.reduce((sum, file) => sum + file.bytes, 0) > binding.policy.maxBytes
    || snapshot.files.some(file => file.bytes > binding.policy.maxFileBytes || isRepositoryPathExcluded(file.path, binding.policy)
      || !isSafeToIngest({ path: file.path, content: file.content, commit: snapshot.parentCommitSha }))) fail('snapshot-policy-violation')
}
export function readSnapshotFile(snapshot: RepositorySnapshot, binding: RepositoryBinding, path: string,
  scope: RepositoryScope, maxBytes = MAX_FILE_BYTES): SnapshotSourceFile {
  assertRepositorySnapshotScope(snapshot, binding, scope)
  normalizeRepositoryPath(path); boundedInteger(maxBytes, 1, MAX_FILE_BYTES)
  if (isRepositoryPathExcluded(path, binding.policy)) fail('path-excluded')
  const file = snapshot.files.find(f => f.path === path)
  if (!file) fail('snapshot-file-missing')
  if (file.bytes > maxBytes) fail('read-byte-limit')
  return file
}
export function readFileSpan(snapshot: RepositorySnapshot, binding: RepositoryBinding, input: {
  path: string; startLine: number; endLine: number; maxBytes?: number
}, scope: RepositoryScope): FileSpan {
  const startLine = boundedInteger(input.startLine, 1, 1_000_000)
  const endLine = boundedInteger(input.endLine, startLine, Math.min(1_000_000, startLine + 499))
  const maxBytes = boundedInteger(input.maxBytes ?? 64 * 1024, 1, 64 * 1024)
  const file = readSnapshotFile(snapshot, binding, input.path, scope)
  const lines = file.content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (endLine > lines.length) fail('line-range-missing')
  const excerpt = lines.slice(startLine - 1, endLine).join('\n')
  if (Buffer.byteLength(excerpt) > maxBytes) fail('excerpt-byte-limit')
  return frozen({ id: `span_${digest([file.id, snapshot.id, startLine, endLine])}`, fileId: file.id,
    snapshotId: snapshot.id, path: file.path, startLine, endLine, contentHash: file.contentHash, excerpt, sourceVersion: file.sourceVersion })
}
export async function assessSnapshotFreshness(snapshot: RepositorySnapshot, binding: RepositoryBinding,
  scope: RepositoryScope, options: { signal?: AbortSignal } = {}): Promise<RepositoryFreshness> {
  assertRepositorySnapshotScope(snapshot, binding, scope)
  try {
    const current = await captureRepositorySnapshot(binding, { scope, signal: options.signal })
    return frozen({ state: current.id === snapshot.id ? 'current' : 'stale', currentSnapshotId: current.id })
  } catch (error) {
    checkCancellation(options.signal)
    if (error instanceof RepositoryContractError) return frozen({ state: 'unavailable', reason: error.code })
    throw error
  }
}

function validateRef(input: unknown): RepositoryRef {
  const value = object(input)
  const allowed = new Set(['version', 'kind', 'workspaceId', 'projectId', 'repositoryId', 'bindingId', 'snapshotId', 'path', 'startLine', 'endLine'])
  if (Object.keys(value).some(k => !allowed.has(k)) || value.version !== 1 || !['snapshot', 'file', 'span'].includes(String(value.kind))) fail('invalid-ref')
  const result: RepositoryRef = { version: 1, kind: value.kind as RepositoryRef['kind'], workspaceId: identifier(value.workspaceId),
    projectId: identifier(value.projectId), repositoryId: recordId(value.repositoryId, 'repo_'),
    bindingId: recordId(value.bindingId, 'binding_'), snapshotId: recordId(value.snapshotId, 'snapshot_'),
    ...(value.path === undefined ? {} : { path: normalizeRepositoryPath(value.path) }),
    ...(value.startLine === undefined ? {} : { startLine: boundedInteger(value.startLine, 1, 1_000_000) }),
    ...(value.endLine === undefined ? {} : { endLine: boundedInteger(value.endLine, 1, 1_000_000) }) }
  if (result.kind === 'snapshot' && (result.path !== undefined || result.startLine !== undefined || result.endLine !== undefined)) fail('invalid-ref')
  if (result.kind === 'file' && (!result.path || result.startLine !== undefined || result.endLine !== undefined)) fail('invalid-ref')
  if (result.kind === 'span' && (!result.path || result.startLine === undefined || result.endLine === undefined || result.endLine < result.startLine || result.endLine - result.startLine > 499)) fail('invalid-ref')
  return frozen(result)
}
export function serializeRepositoryRef(ref: RepositoryRef): string {
  return `rox-code:v1:${Buffer.from(JSON.stringify(validateRef(ref))).toString('base64url')}`
}
export function parseRepositoryRef(serialized: string): RepositoryRef {
  if (typeof serialized !== 'string' || serialized.length > 4096 || !/^rox-code:v1:[A-Za-z0-9_-]+$/.test(serialized)) fail('invalid-ref')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(serialized.slice('rox-code:v1:'.length), 'base64url').toString('utf8')) }
  catch { return fail('invalid-ref') }
  const ref = validateRef(parsed)
  if (serializeRepositoryRef(ref) !== serialized) fail('non-canonical-ref')
  return ref
}
export function resolveRepositoryRef(ref: RepositoryRef, snapshot: RepositorySnapshot, binding: RepositoryBinding,
  scope: RepositoryScope): RepositorySnapshot | SnapshotSourceFile | FileSpan {
  const checked = validateRef(ref)
  assertRepositorySnapshotScope(snapshot, binding, scope)
  if (checked.workspaceId !== scope.workspaceId || checked.projectId !== scope.projectId || checked.bindingId !== binding.id
    || checked.repositoryId !== binding.repositoryId || checked.snapshotId !== snapshot.id) fail('scope-denied')
  if (checked.kind === 'snapshot') return snapshot
  if (checked.kind === 'file') return readSnapshotFile(snapshot, binding, checked.path!, scope)
  return readFileSpan(snapshot, binding, { path: checked.path!, startLine: checked.startLine!, endLine: checked.endLine! }, scope)
}

/**
 * Recheck a historical receipt against a separately resolved current binding.
 * The host must resolve currentBinding from live project/session authority for EVERY read;
 * this pure contract does not discover actors, renew leases, or grant provider egress.
 */
export function assertRepositoryCurrentReadPolicy(snapshot: RepositorySnapshot, receiptBinding: RepositoryBinding,
  currentBinding: RepositoryBinding, scope: RepositoryScope, path?: string): void {
  assertRepositorySnapshotScope(snapshot, receiptBinding, scope)
  validateRepositoryBinding(currentBinding); assertRepositoryScope(currentBinding, scope)
  if (receiptBinding.id !== currentBinding.id || receiptBinding.repositoryId !== currentBinding.repositoryId
    || receiptBinding.canonicalRoot !== currentBinding.canonicalRoot) fail('scope-denied')
  const files = path === undefined ? snapshot.files : [readSnapshotFile(snapshot, receiptBinding, normalizeRepositoryPath(path), scope)]
  if (path === undefined && snapshot.coverage.totalPaths > currentBinding.policy.maxFiles) fail('current-policy-file-count-limit')
  for (const file of files) {
    if (isRepositoryPathExcluded(file.path, currentBinding.policy)) fail('path-excluded')
    if (file.bytes > currentBinding.policy.maxFileBytes) fail('current-policy-byte-limit')
  }
  if (files.reduce((sum, file) => sum + file.bytes, 0) > currentBinding.policy.maxBytes) fail('current-policy-byte-limit')
}

/** Exact immutable refs with mandatory separate current authorization supplied by the host. */
export function resolveRepositoryRefWithCurrentPolicy(ref: RepositoryRef, snapshot: RepositorySnapshot,
  receiptBinding: RepositoryBinding, currentBinding: RepositoryBinding, scope: RepositoryScope): RepositorySnapshot | SnapshotSourceFile | FileSpan {
  const checked = validateRef(ref)
  assertRepositoryCurrentReadPolicy(snapshot, receiptBinding, currentBinding, scope, checked.kind === 'snapshot' ? undefined : checked.path)
  return resolveRepositoryRef(checked, snapshot, receiptBinding, scope)
}

async function storeRoot(directory: string, create = false): Promise<string> {
  const path = absolutePath(directory)
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  return realpath(path)
}
async function boundedRecord(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) fail('record-byte-limit')
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_RECORD_BYTES + 1))
    let length = 0
    while (length < buffer.length) {
      const chunk = await handle.read(buffer, length, buffer.length - length, null)
      if (!chunk.bytesRead) break
      length += chunk.bytesRead
    }
    const bytes = buffer.subarray(0, length)
    if (bytes.length > MAX_RECORD_BYTES) fail('record-byte-limit')
    try { return JSON.parse(bytes.toString('utf8')) } catch { return fail('invalid-record-json') }
  } finally { await handle.close() }
}
async function writeRecord(directory: string, id: string, record: unknown, immutable: boolean): Promise<string> {
  const root = await storeRoot(directory, true), target = resolve(root, `${id}.json`)
  const temporary = resolve(root, `.${id}.${process.pid}.${randomUUID()}.tmp`)
  const bytes = JSON.stringify(record)
  if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) fail('record-byte-limit')
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try {
    if (immutable) {
      try { await link(temporary, target) }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const existing = validateRepositorySnapshot(await boundedRecord(target))
        if (existing.id !== id) fail('immutable-record-conflict')
      }
    } else await rename(temporary, target)
  } finally { await unlink(temporary).catch(() => undefined) }
  return target
}
export async function saveRepositoryBinding(binding: RepositoryBinding, directory: string, scope: RepositoryScope): Promise<string> {
  const checked = validateRepositoryBinding(binding); assertRepositoryScope(checked, scope)
  return writeRecord(directory, checked.id, checked, false)
}
export async function loadRepositoryBinding(directory: string, id: string, scope: RepositoryScope,
  options: { immutableReceipt?: boolean } = {}): Promise<RepositoryBinding> {
  recordId(id, 'binding_')
  const binding = validateRepositoryBinding(await boundedRecord(resolve(await storeRoot(directory), `${id}.json`)))
  if (binding.id !== id) fail('invalid-binding-identity')
  assertRepositoryScope(binding, scope)
  // Historical receipts are validated against current authorization by their caller, without retargeting captured bytes.
  if (!options.immutableReceipt) await enforceLiveRoot(binding)
  return binding
}
export async function saveRepositorySnapshot(snapshot: RepositorySnapshot, binding: RepositoryBinding,
  directory: string, scope: RepositoryScope): Promise<string> {
  assertRepositorySnapshotScope(snapshot, binding, scope)
  return writeRecord(directory, snapshot.id, snapshot, true)
}
export async function loadRepositorySnapshot(directory: string, id: string, binding: RepositoryBinding,
  scope: RepositoryScope): Promise<RepositorySnapshot> {
  recordId(id, 'snapshot_')
  validateRepositoryBinding(binding); assertRepositoryScope(binding, scope)
  const snapshot = validateRepositorySnapshot(await boundedRecord(resolve(await storeRoot(directory), `${id}.json`)))
  if (snapshot.id !== id) fail('invalid-snapshot-identity')
  assertRepositorySnapshotScope(snapshot, binding, scope)
  return snapshot
}

/** Additive migration: legacy configs without repositoryBindings remain valid and unchanged. */
export function repositoryBindingsFromConfig(config: unknown, scope: RepositoryScope): readonly RepositoryBinding[] {
  const value = object(config)
  if (value.repositoryBindings === undefined) return frozen([])
  if (!Array.isArray(value.repositoryBindings) || value.repositoryBindings.length > 64) fail('invalid-bindings')
  const bindings = value.repositoryBindings.map(validateRepositoryBinding)
  for (const binding of bindings) assertRepositoryScope(binding, scope)
  if (new Set(bindings.map(b => b.id)).size !== bindings.length) fail('duplicate-binding')
  return frozen(bindings)
}
