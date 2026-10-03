import { afterEach, describe, expect, it } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  assessSnapshotFreshness,
  bindRepository,
  captureRepositorySnapshot,
  isRepositoryPathExcluded,
  loadRepositoryBinding,
  loadRepositorySnapshot,
  normalizeRepositoryPath,
  parseRepositoryRef,
  readFileSpan,
  readSnapshotFile,
  repositoryBindingsFromConfig,
  resolveRepositoryRef,
  saveRepositoryBinding,
  saveRepositorySnapshot,
  serializeRepositoryRef,
  validateRepositorySnapshot,
} from '../refs.ts'
import type { ProviderPolicyInput, RepositoryBinding, RepositoryRef } from '../refs.ts'
import {
  CODE_INTELLIGENCE_PROVIDER_DECISION,
  CodeIntelligenceProviderRegistry,
  indexVerifiedSnapshotFiles,
  scopedProviderResourceId,
} from '../provider.ts'
import { localFsSymbolsAdapter } from '../local-adapter.ts'
import { CODE_INTEL_PACK } from '../types.ts'

const exec = promisify(execFile)
const scope = { workspaceId: 'workspace-one', projectId: 'project-one' }
const temporaryRoots: string[] = []

afterEach(async () => {
  for (const directory of temporaryRoots.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(policy: Partial<ProviderPolicyInput> = {}): Promise<{
  root: string; repository: string; store: string; binding: RepositoryBinding
}> {
  const root = await mkdtemp(join(tmpdir(), 'rox-ci-contract-'))
  temporaryRoots.push(root)
  const repository = join(root, 'repository'), store = join(root, 'store')
  await mkdir(join(repository, 'src'), { recursive: true })
  await writeFile(join(repository, 'src/main.ts'), 'export function hello() {\n  return "hello"\n}\n')
  await writeFile(join(repository, 'README.md'), '# Fixture\n')
  await writeFile(join(repository, '.gitignore'), 'ignored.txt\n')
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['add', '.'])
  await git(repository, ['-c', 'user.name=Contract Test', '-c', 'user.email=contract@example.invalid', 'commit', '-m', 'fixture'])
  const binding = await bindRepository({ ...scope, workingDirectory: join(repository, 'src'),
    policy: { ...policy, workspaceId: scope.workspaceId, allowedRoots: [root] }, now: 10 })
  return { root, repository, store, binding }
}
async function git(root: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', root, ...args], { encoding: 'utf8' })).stdout
}

describe('repository binding and immutable source snapshots against real Git', () => {
  it('propagates cancellation through snapshot and freshness checks without an unavailable receipt', async () => {
    const { binding } = await fixture()
    const snapshot = await captureRepositorySnapshot(binding, { scope })
    const controller = new AbortController()
    const pending = captureRepositorySnapshot(binding, { scope, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('request-cancelled')
    await expect(assessSnapshotFreshness(snapshot, binding, scope, { signal: controller.signal })).rejects.toThrow('request-cancelled')
  }, 30000)

  it('canonicalizes subdirectories and aliases while separating repository, project and source identities', async () => {
    const { root, repository, binding } = await fixture()
    const alias = join(root, 'alias')
    await symlink(repository, alias)
    const fromAlias = await bindRepository({ ...scope, workingDirectory: alias,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [root] }, now: 11 })
    const anotherProject = await bindRepository({ ...scope, projectId: 'project-two', workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [root] } })
    expect(binding.canonicalRoot).toBe(await realpath(repository))
    expect(fromAlias.id).toBe(binding.id)
    expect(anotherProject.repositoryId).toBe(binding.repositoryId)
    expect(anotherProject.id).not.toBe(binding.id)
    expect(binding.repositoryId).not.toBe(binding.projectId)
    expect(binding.policy.dataEgress).toBe('deny')
    await expect(bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [join(repository, 'src')] } })).rejects.toThrow('root-denied')
    await expect(bindRepository({ ...scope, workingDirectory: join(root, 'missing'),
      policy: { workspaceId: scope.workspaceId, allowedRoots: [root] } })).rejects.toThrow('root-missing')
    await expect(bindRepository({ ...scope, workingDirectory: root,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [root] } })).rejects.toThrow('git-unavailable-or-invalid-repository')
  }, 30000)

  it('uses actual parent commit and tree identities and produces the same identity on repeated clean captures', async () => {
    const { repository, binding } = await fixture()
    const first = await captureRepositorySnapshot(binding, { scope, now: 12 })
    const second = await captureRepositorySnapshot(binding, { scope, now: 13 })
    expect(first.parentCommitSha).toBe((await git(repository, ['rev-parse', 'HEAD'])).trim())
    expect(first.treeSha).toBe((await git(repository, ['rev-parse', 'HEAD^{tree}'])).trim())
    expect(first.id).toBe(second.id)
    expect(first.dirty).toBe(false)
    expect(first.dirtyWorkingCopyDigest).toBeUndefined()
    expect(first.coverage).toEqual({ includedCount: 3, skippedCount: 0, totalPaths: 3, truncated: false })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.files[0])).toBe(true)
    const file = readSnapshotFile(first, binding, 'src/main.ts', scope)
    expect(file.commitSha).toBe(first.parentCommitSha)
    expect(file.sourceVersion).toEqual({ kind: 'git-commit', value: first.parentCommitSha })
    expect(file.blobSha).toBe((await git(repository, ['rev-parse', 'HEAD:src/main.ts'])).trim())
    expect(validateRepositorySnapshot(JSON.parse(JSON.stringify(first))).id).toBe(first.id)
  }, 30000)

  it('keeps dirty bytes immutable, fingerprints changes, and never attributes changed bytes to the parent commit', async () => {
    const { repository, binding } = await fixture()
    const clean = await captureRepositorySnapshot(binding, { scope })
    await writeFile(join(repository, 'src/main.ts'), 'export function changed() { return 2 }\n')
    const dirty = await captureRepositorySnapshot(binding, { scope })
    const changed = readSnapshotFile(dirty, binding, 'src/main.ts', scope)
    expect(dirty.dirty).toBe(true)
    expect(dirty.id).not.toBe(clean.id)
    expect(dirty.parentCommitSha).toBe(clean.parentCommitSha)
    expect(dirty.dirtyWorkingCopyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(changed.commitSha).toBeUndefined()
    expect(changed.sourceVersion).toEqual({ kind: 'working-copy', value: changed.contentHash })
    expect(readSnapshotFile(dirty, binding, 'README.md', scope).commitSha).toBe(clean.parentCommitSha)
    await writeFile(join(repository, 'src/main.ts'), 'export function changedAgain() { return 3 }\n')
    expect(readSnapshotFile(dirty, binding, 'src/main.ts', scope).content).toContain('return 2')
    const newer = await captureRepositorySnapshot(binding, { scope })
    expect(newer.id).not.toBe(dirty.id)
    expect(newer.dirtyWorkingCopyDigest).not.toBe(dirty.dirtyWorkingCopyDigest)
    expect((await assessSnapshotFreshness(dirty, binding, scope)).state).toBe('stale')
    expect((await assessSnapshotFreshness(newer, binding, scope)).state).toBe('current')
    expect(indexVerifiedSnapshotFiles(localFsSymbolsAdapter, dirty, binding, scope).symbols.some(s => s.path === 'src/main.ts')).toBe(false)
  }, 30000)

  it('detects modified bytes even when Git assume-unchanged suppresses status', async () => {
    const { repository, binding } = await fixture()
    await git(repository, ['update-index', '--assume-unchanged', 'src/main.ts'])
    await writeFile(join(repository, 'src/main.ts'), 'export const invisibleToStatus = 1\n')
    expect(await git(repository, ['status', '--porcelain'])).toBe('')
    const captured = await captureRepositorySnapshot(binding, { scope })
    expect(captured.dirty).toBe(true)
    expect(captured.dirtyWorkingCopyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(readSnapshotFile(captured, binding, 'src/main.ts', scope).commitSha).toBeUndefined()
  }, 30000)

  it('has explicit exclusion, Git-ignore and secret coverage without reading symlink destinations', async () => {
    const { root, repository, binding } = await fixture({ excludes: ['README.md', '**/private/**'] })
    await writeFile(join(root, 'outside.ts'), 'NEVER_INGEST_OUTSIDE_CONTENT\n')
    await symlink(join(root, 'outside.ts'), join(repository, 'outside-link.ts'))
    await writeFile(join(repository, 'ignored.txt'), 'ignored by Git\n')
    await writeFile(join(repository, 'secret.ts'), 'const token = "sk-abcdefghijkl"\n')
    await mkdir(join(repository, 'private'))
    await writeFile(join(repository, 'private/key.ts'), 'excluded\n')
    await mkdir(join(repository, 'node_modules'))
    await writeFile(join(repository, 'node_modules/ignored.ts'), 'vendor\n')
    const captured = await captureRepositorySnapshot(binding, { scope })
    expect(captured.skipped).toContainEqual({ path: 'README.md', reason: 'excluded' })
    expect(captured.skipped).toContainEqual({ path: 'private/key.ts', reason: 'excluded' })
    expect(captured.skipped).toContainEqual({ path: 'node_modules/ignored.ts', reason: 'excluded' })
    expect(captured.skipped).toContainEqual({ path: 'secret.ts', reason: 'secret' })
    expect(captured.skipped).toContainEqual({ path: 'outside-link.ts', reason: 'symlink' })
    expect(JSON.stringify(captured)).not.toContain('NEVER_INGEST_OUTSIDE_CONTENT')
    expect([...captured.files, ...captured.skipped].some(f => f.path === 'ignored.txt')).toBe(false)
    expect(() => readSnapshotFile(captured, binding, 'README.md', scope)).toThrow('path-excluded')
    expect(() => readSnapshotFile(captured, binding, 'outside-link.ts', scope)).toThrow('snapshot-file-missing')
  }, 30000)

  it('rejects symlinks in ancestors of tracked files, including replaced directories', async () => {
    const { root, repository, binding } = await fixture()
    await mkdir(join(repository, 'nested'))
    await writeFile(join(repository, 'nested/file.ts'), 'inside\n')
    await git(repository, ['add', 'nested/file.ts'])
    await git(repository, ['-c', 'user.name=Contract Test', '-c', 'user.email=contract@example.invalid', 'commit', '-m', 'nested'])
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside/file.ts'), 'OUTSIDE_ANCESTOR_SECRET\n')
    await rm(join(repository, 'nested'), { recursive: true })
    await symlink(join(root, 'outside'), join(repository, 'nested'))
    const captured = await captureRepositorySnapshot(binding, { scope })
    expect(captured.skipped).toContainEqual({ path: 'nested/file.ts', reason: 'symlink' })
    expect(JSON.stringify(captured)).not.toContain('OUTSIDE_ANCESTOR_SECRET')
  }, 30000)

  it('reports tracked missing and binary files and enforces byte/count limits', async () => {
    const { repository, binding } = await fixture({ maxFileBytes: 100 })
    await rm(join(repository, 'README.md'))
    await writeFile(join(repository, 'large.ts'), 'a'.repeat(101))
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 1, 2]))
    const captured = await captureRepositorySnapshot(binding, { scope })
    expect(captured.skipped).toContainEqual({ path: 'README.md', reason: 'missing' })
    expect(captured.skipped).toContainEqual({ path: 'large.ts', reason: 'file-byte-limit' })
    expect(captured.skipped).toContainEqual({ path: 'binary.bin', reason: 'binary' })
    expect(captured.coverage.truncated).toBe(true)
    expect(() => readSnapshotFile(captured, binding, 'absent.ts', scope)).toThrow('snapshot-file-missing')
    expect(() => readSnapshotFile(captured, binding, 'src/main.ts', scope, 1)).toThrow('read-byte-limit')
    const smallBinding = await bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], maxFiles: 1 } })
    await expect(captureRepositorySnapshot(smallBinding, { scope })).rejects.toThrow('file-count-limit')
    const bytesBinding = await bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], maxBytes: 2 } })
    const bounded = await captureRepositorySnapshot(bytesBinding, { scope })
    expect(bounded.files.length).toBe(0)
    expect(bounded.skipped.some(f => f.reason === 'snapshot-byte-limit')).toBe(true)
    expect(bounded.coverage.truncated).toBe(true)
  }, 30000)

  it('rejects forged commit attribution and corrupted immutable content', async () => {
    const { repository, binding } = await fixture()
    await writeFile(join(repository, 'src/main.ts'), 'export function dirty() {}\n')
    const captured = await captureRepositorySnapshot(binding, { scope })
    const corrupt = JSON.parse(JSON.stringify(captured))
    corrupt.files.find((f: { path: string }) => f.path === 'src/main.ts').content += 'corrupt'
    expect(() => validateRepositorySnapshot(corrupt)).toThrow('invalid-snapshot-content')
    const forged = JSON.parse(JSON.stringify(captured))
    forged.files.find((f: { path: string }) => f.path === 'src/main.ts').commitSha = captured.parentCommitSha
    expect(() => validateRepositorySnapshot(forged)).toThrow('false-commit-citation')
  }, 30000)

  it('persists a scoped binding and dirty snapshot and loads them in a new Bun process', async () => {
    const { repository, store, binding } = await fixture()
    await writeFile(join(repository, 'src/main.ts'), 'export function persistedDirty() {}\n')
    const captured = await captureRepositorySnapshot(binding, { scope, now: 20 })
    await saveRepositoryBinding(binding, store, scope)
    await saveRepositorySnapshot(captured, binding, store, scope)
    // Idempotent saves retain the first immutable receipt rather than rewriting capturedAt.
    await saveRepositorySnapshot({ ...captured, capturedAt: 21 }, binding, store, scope)
    expect((await loadRepositorySnapshot(store, captured.id, binding, scope)).capturedAt).toBe(20)
    const module = resolve(import.meta.dir, '../refs.ts')
    const script = `const m = await import(${JSON.stringify(module)}); const scope = ${JSON.stringify(scope)};
      const binding = await m.loadRepositoryBinding(${JSON.stringify(store)}, ${JSON.stringify(binding.id)}, scope);
      const snapshot = await m.loadRepositorySnapshot(${JSON.stringify(store)}, ${JSON.stringify(captured.id)}, binding, scope);
      console.log(JSON.stringify({binding:binding.id,snapshot:snapshot.id,version:m.readSnapshotFile(snapshot,binding,'src/main.ts',scope).sourceVersion}));`
    const result = await exec(process.execPath, ['-e', script], { encoding: 'utf8' })
    expect(JSON.parse(result.stdout)).toEqual({ binding: binding.id, snapshot: captured.id,
      version: { kind: 'working-copy', value: readSnapshotFile(captured, binding, 'src/main.ts', scope).contentHash } })
    await expect(loadRepositoryBinding(store, binding.id, { ...scope, projectId: 'foreign' })).rejects.toThrow('scope-denied')
    await expect(loadRepositorySnapshot(store, '../snapshot', binding, scope)).rejects.toThrow('invalid-record-id')
    const jsonPath = join(store, `${captured.id}.json`)
    const corrupt = JSON.parse(await readFile(jsonPath, 'utf8'))
    corrupt.files[0].content = 'altered persistence'
    await writeFile(jsonPath, JSON.stringify(corrupt))
    await expect(loadRepositorySnapshot(store, captured.id, binding, scope)).rejects.toThrow('invalid-snapshot-content')
  }, 30000)
})

describe('bounded refs, evidence spans and source policy', () => {
  it('round-trips snapshot/file/span refs and reads bounded immutable line evidence', async () => {
    const { binding } = await fixture()
    const snapshot = await captureRepositorySnapshot(binding, { scope })
    const base = { version: 1 as const, ...scope, bindingId: binding.id, repositoryId: binding.repositoryId, snapshotId: snapshot.id }
    for (const ref of [
      { ...base, kind: 'snapshot' },
      { ...base, kind: 'file', path: 'src/main.ts' },
      { ...base, kind: 'span', path: 'src/main.ts', startLine: 1, endLine: 2 },
    ] as RepositoryRef[]) {
      expect(parseRepositoryRef(serializeRepositoryRef(ref))).toEqual(ref)
      expect(resolveRepositoryRef(ref, snapshot, binding, scope)).toBeTruthy()
    }
    const span = readFileSpan(snapshot, binding, { path: 'src/main.ts', startLine: 1, endLine: 2 }, scope)
    expect(span.excerpt).toBe('export function hello() {\n  return "hello"')
    expect(span.sourceVersion.kind).toBe('git-commit')
    expect(() => readFileSpan(snapshot, binding, { path: 'src/main.ts', startLine: 0, endLine: 2 }, scope)).toThrow('invalid-limit')
    expect(() => readFileSpan(snapshot, binding, { path: 'src/main.ts', startLine: 1, endLine: 501 }, scope)).toThrow('invalid-limit')
    expect(() => readFileSpan(snapshot, binding, { path: 'src/main.ts', startLine: 1, endLine: 9 }, scope)).toThrow('line-range-missing')
    expect(() => readFileSpan(snapshot, binding, { path: 'src/main.ts', startLine: 1, endLine: 2, maxBytes: 1 }, scope)).toThrow('excerpt-byte-limit')
    const foreignRef = { ...base, kind: 'file' as const, path: 'src/main.ts', projectId: 'foreign' }
    expect(() => resolveRepositoryRef(foreignRef, snapshot, binding, scope)).toThrow('scope-denied')
  }, 30000)

  it('rejects traversal, ambiguous paths, excessive refs and invalid exclusions', async () => {
    for (const path of ['../private.ts', '/etc/passwd', 'a/../b', 'a//b', './x', 'a\\b', 'a\0b', 'a\nb']) {
      expect(() => normalizeRepositoryPath(path)).toThrow('invalid-path')
    }
    expect(() => parseRepositoryRef('rox-code:v1:'.padEnd(5000, 'x'))).toThrow('invalid-ref')
    expect(() => parseRepositoryRef('rox-code:v2:abc')).toThrow('invalid-ref')
    const { repository, binding } = await fixture({ excludes: ['dist/', '**/*.map'] })
    expect(isRepositoryPathExcluded('dist/a.js', binding.policy)).toBe(true)
    expect(isRepositoryPathExcluded('src/a.map', binding.policy)).toBe(true)
    expect(isRepositoryPathExcluded('a.map', binding.policy)).toBe(true)
    await expect(bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], excludes: ['../escape'] } })).rejects.toThrow('invalid-exclusion')
    await expect(bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], maxFileBytes: 999_999 } })).rejects.toThrow('invalid-limit')
  }, 30000)

  it('denies foreign scope and policy-changed snapshot reads, retaining readable legacy configurations', async () => {
    const { repository, binding } = await fixture()
    const snapshot = await captureRepositorySnapshot(binding, { scope })
    expect(() => readSnapshotFile(snapshot, binding, 'src/main.ts', { ...scope, workspaceId: 'foreign' })).toThrow('scope-denied')
    const changedPolicy = await bindRepository({ ...scope, workingDirectory: repository,
      policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], excludes: ['src'] } })
    expect(changedPolicy.id).toBe(binding.id)
    expect(() => readSnapshotFile(snapshot, changedPolicy, 'src/main.ts', scope)).toThrow('snapshot-policy-changed')
    const legacy = { id: 'legacy', workingDirectory: repository, arbitraryField: { value: 1 } }
    expect(repositoryBindingsFromConfig(legacy, scope)).toEqual([])
    expect(legacy).toEqual({ id: 'legacy', workingDirectory: repository, arbitraryField: { value: 1 } })
    expect(repositoryBindingsFromConfig({ ...legacy, repositoryBindings: [binding] }, scope)).toEqual([binding])
  }, 30000)
})

describe('provider-neutral contracts extend the existing selected pack', () => {
  it('keeps selected/rejected decisions explicit, denies unknown and rejected providers, and requires opt-in', async () => {
    const { binding } = await fixture()
    const snapshot = await captureRepositorySnapshot(binding, { scope })
    const provider = { id: 'local-fs-symbols', version: 'rox-local-v1', alwaysOn: false as const,
      operations: ['symbols'] as const, execution: 'local' as const, readiness: 'ready' as const, adapter: localFsSymbolsAdapter }
    const registry = new CodeIntelligenceProviderRegistry([provider])
    const context = { binding, snapshot, scope, enabled: true, allowedProviderIds: [provider.id] }
    expect(registry.resolve(provider.id, 'symbols', context).adapter).toBe(localFsSymbolsAdapter)
    expect(() => registry.resolve('unknown-provider', 'symbols', context)).toThrow('unknown-provider')
    expect(() => registry.resolve(provider.id, 'symbols', { ...context, enabled: false })).toThrow('provider-disabled')
    expect(() => registry.resolve(provider.id, 'source-graph', context)).toThrow('unsupported-provider-operation')
    expect(() => registry.register({ ...provider, id: 'deepwiki', adapter: undefined })).toThrow('rejected-provider')
    expect(() => registry.register({ ...provider, id: 'new-provider', adapter: undefined })).toThrow('unverified-provider-manifest')
    expect(CODE_INTELLIGENCE_PROVIDER_DECISION.revision).toBe('CI-DEC-EXTEND-EXISTING-01')
    expect(CODE_INTELLIGENCE_PROVIDER_DECISION.selected).toEqual(['local-fs-symbols', 'syft-sbom'])
    expect(CODE_INTELLIGENCE_PROVIDER_DECISION.inventoryDeclarationIsRuntimeEvidence).toBe(false)
    expect(CODE_INTEL_PACK.alwaysOn).toBe(false)
    expect(indexVerifiedSnapshotFiles(localFsSymbolsAdapter, snapshot, binding, scope).symbols.some(s => s.name === 'hello')).toBe(true)
    const resource = scopedProviderResourceId({ binding, snapshot, scope, provider, providerResourceId: 'node-1' })
    expect(resource).toMatch(/^provider-resource_[a-f0-9]{64}$/)
    expect(resource).not.toBe('node-1')
    expect(scopedProviderResourceId({ binding, snapshot, scope, provider: { ...provider, version: 'rox-local-v2' }, providerResourceId: 'node-1' })).not.toBe(resource)
  }, 30000)

  it('enforces runtime readiness, data-egress policy and scope at provider selection', async () => {
    const { binding } = await fixture()
    const snapshot = await captureRepositorySnapshot(binding, { scope })
    const registry = new CodeIntelligenceProviderRegistry([
      { id: 'syft-sbom', version: 'runtime-unprobed', alwaysOn: false, operations: ['sbom'], execution: 'local', readiness: 'requires-runtime-probe' },
      { id: 'pinned-diagram', version: '1.0.0', alwaysOn: false, operations: ['diagram'], execution: 'remote', readiness: 'ready', sourceRevision: 'a'.repeat(40), artifactDigest: 'b'.repeat(64) },
    ])
    const context = { binding, snapshot, scope, enabled: true, allowedProviderIds: ['syft-sbom', 'pinned-diagram'] }
    expect(() => registry.resolve('syft-sbom', 'sbom', context)).toThrow('provider-runtime-unready')
    expect(() => registry.resolve('pinned-diagram', 'diagram', context)).toThrow('provider-egress-denied')
    expect(() => registry.resolve('pinned-diagram', 'diagram', { ...context, scope: { ...scope, projectId: 'foreign' } })).toThrow('scope-denied')
  }, 30000)
})
