/** Current policy is live host authority; immutable refs only identify historical bytes. */
import { afterEach, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { bindRepository, captureRepositorySnapshot, parseRepositoryRef, resolveRepositoryRefWithCurrentPolicy,
  serializeRepositoryRef } from '../../packages/shared/src/code-intelligence/refs.ts'
import type { RepositoryBinding, RepositoryRef } from '../../packages/shared/src/code-intelligence/refs.ts'
import { loadProjectById, saveProjectConfig } from '../../packages/shared/src/projects/index.ts'

const exec = promisify(execFile)
const scope = { workspaceId: 'live-policy-workspace', projectId: 'live-policy-project' }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-ci-current-policy-')); roots.push(root)
  const repository = join(root, 'repository'), workspace = join(root, 'workspace')
  await mkdir(join(repository, 'src'), { recursive: true })
  await writeFile(join(repository, 'src/main.ts'), 'export const permitted = 42\n')
  await writeFile(join(repository, 'README.md'), '# Historical document\n')
  await exec('git', ['-C', repository, 'init', '--initial-branch=main'])
  await exec('git', ['-C', repository, 'add', '.'])
  await exec('git', ['-C', repository, '-c', 'user.name=Current Policy', '-c', 'user.email=policy@example.invalid', 'commit', '-m', 'fixture'])
  const binding = await bindRepository({ ...scope, workingDirectory: repository, policy: { workspaceId: scope.workspaceId, allowedRoots: [repository], includes: ['**'], approvedBranch: 'main' } })
  saveProjectConfig(workspace, { id: scope.projectId, slug: scope.projectId, name: 'Current Policy', workingDirectory: repository, createdAt: 1, updatedAt: 1, repositoryBindings: [binding] })
  const snapshot = await captureRepositorySnapshot(binding, { scope })
  function currentBinding(): RepositoryBinding {
    const project = loadProjectById(workspace, scope.projectId)
    const current = project?.config.repositoryBindings?.[0]
    if (!current) throw new Error('live project binding unavailable')
    return current
  }
  function persist(current: RepositoryBinding) {
    const project = loadProjectById(workspace, scope.projectId)
    if (!project) throw new Error('live project unavailable')
    saveProjectConfig(workspace, { ...project.config, repositoryBindings: [current] })
  }
  const ref: RepositoryRef = { version: 1, kind: 'span', ...scope, repositoryId: binding.repositoryId, bindingId: binding.id,
    snapshotId: snapshot.id, path: 'src/main.ts', startLine: 1, endLine: 1 }
  return { root, repository, binding, snapshot, currentBinding, persist, ref }
}

test('rechecks a historical serialized ref against a freshly loaded narrowed project policy', async () => {
  const f = await fixture()
  const serialized = serializeRepositoryRef(f.ref), parsed = parseRepositoryRef(serialized)
  const narrowed = await bindRepository({ ...scope, workingDirectory: f.repository, policy: {
    workspaceId: scope.workspaceId, allowedRoots: [f.repository], includes: ['src/**'], approvedBranch: 'main',
  } })
  f.persist(narrowed)
  const span = resolveRepositoryRefWithCurrentPolicy(parsed, f.snapshot, f.binding, f.currentBinding(), scope)
  expect('excerpt' in span && span.excerpt).toBe('export const permitted = 42')
  expect(() => resolveRepositoryRefWithCurrentPolicy({ ...parsed, path: 'README.md' }, f.snapshot, f.binding, f.currentBinding(), scope)).toThrow('path-excluded')
  expect(() => resolveRepositoryRefWithCurrentPolicy({ ...parsed, kind: 'snapshot', path: undefined, startLine: undefined, endLine: undefined }, f.snapshot, f.binding, f.currentBinding(), scope)).toThrow('path-excluded')
  expect(serializeRepositoryRef(parsed)).toBe(serialized)
  expect(f.snapshot.files.find(file => file.path === 'README.md')?.content).toBe('# Historical document\n')
})

test('ref reads fail after durable limit or repository authorization changes', async () => {
  const f = await fixture()
  const limited = await bindRepository({ ...scope, workingDirectory: f.repository, policy: {
    workspaceId: scope.workspaceId, allowedRoots: [f.repository], maxFileBytes: 1, approvedBranch: 'main',
  } })
  f.persist(limited)
  expect(() => resolveRepositoryRefWithCurrentPolicy(f.ref, f.snapshot, f.binding, f.currentBinding(), scope)).toThrow('current-policy-byte-limit')
  const foreign = await bindRepository({ ...scope, projectId: 'foreign-project', workingDirectory: f.repository,
    policy: { workspaceId: scope.workspaceId, allowedRoots: [f.repository] } })
  expect(() => resolveRepositoryRefWithCurrentPolicy(f.ref, f.snapshot, f.binding, foreign, scope)).toThrow('scope-denied')
  const other = join(f.root, 'other'); await mkdir(other)
  await exec('git', ['-C', other, 'init', '--initial-branch=main'])
  const moved = await bindRepository({ ...scope, workingDirectory: other, policy: { workspaceId: scope.workspaceId, allowedRoots: [other] } })
  f.persist(moved)
  expect(() => resolveRepositoryRefWithCurrentPolicy(f.ref, f.snapshot, f.binding, f.currentBinding(), scope)).toThrow('scope-denied')
})

test('current agent registry does not advertise declarative CI adapters or accept code refs as knowledge refs', async () => {
  const { getSessionToolDefs } = await import('../../packages/session-tools-core/src/tool-defs.ts')
  const { parseKnowledgeRefArg } = await import('../../packages/session-tools-core/src/knowledge/parse-ref.ts')
  const { CODE_INTEL_PACK } = await import('../../packages/shared/src/code-intelligence/types.ts')
  const registered = new Set(getSessionToolDefs().map(tool => tool.name))
  expect(registered.has('knowledge_read')).toBe(true)
  for (const id of CODE_INTEL_PACK.tools) expect(registered.has(id)).toBe(false)
  const f = await fixture()
  expect(parseKnowledgeRefArg(serializeRepositoryRef(f.ref))).toBeNull()
  expect(parseKnowledgeRefArg('document/20260930-local-reference')).toEqual({ scheme: 'siyuan', kind: 'document', id: '20260930-local-reference' })
})
