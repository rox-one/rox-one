import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevSpaceError } from '@rox/session-tools-core'
import { writeDevSpaceArtifact } from '../artifacts.ts'
import { createDevSpaceToolRuntime } from '../tool-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-toolruntime-'))
  roots.push(root)
  return root
}

const repositoryId = `repo_${'b'.repeat(64)}`
const snapshotId = `snapshot_${'c'.repeat(64)}`
const runId = `devrun_${'a'.repeat(64)}`

function seed(root: string, projectSlug: string, overrides: Partial<Parameters<typeof writeDevSpaceArtifact>[0]> = {}) {
  return writeDevSpaceArtifact({
    root, projectSlug, repositoryId, snapshotId, runId,
    kind: 'wiki', name: 'index.md', format: 'md', content: '# Hello kernel notes',
    producedBy: { providerId: 'openwiki', version: '1.2.3' }, sourceRevision: 'd'.repeat(40),
    ...overrides,
  })
}

describe('dev-space tool runtime', () => {
  it('reads an artifact by id with provenance and a content hash, and never applies proposals', async () => {
    const root = freshRoot()
    const entry = await seed(root, 'demo')
    const runtime = createDevSpaceToolRuntime()
    const result = await runtime.read({ workspaceRoot: root, artifactId: entry.id })
    expect(result.encoding).toBe('utf8')
    expect(result.content).toBe('# Hello kernel notes')
    expect(result.contentHash).toBe(createHash('sha256').update('# Hello kernel notes').digest('hex'))
    expect(result.artifact).toMatchObject({
      id: entry.id, kind: 'wiki', format: 'md', projectSlug: 'demo', repositoryId, snapshotId,
      producedBy: { providerId: 'openwiki', version: '1.2.3' },
    })
    expect(runtime.propose).toBeUndefined()
  })

  it('returns base64 for binary formats and NOT_FOUND for unknown ids', async () => {
    const root = freshRoot()
    const entry = await seed(root, 'demo', { kind: 'audio', name: 'podcast.mp3', format: 'mp3', content: 'audio-bytes' })
    const runtime = createDevSpaceToolRuntime()
    const result = await runtime.read({ workspaceRoot: root, artifactId: entry.id })
    expect(result.encoding).toBe('base64')
    expect(result.content).toBe(Buffer.from('audio-bytes').toString('base64'))
    await expect(runtime.read({ workspaceRoot: root, artifactId: 'artifact_missing' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(runtime.read({ workspaceRoot: root, artifactId: 'artifact_missing' })).rejects.toBeInstanceOf(DevSpaceError)
  })

  it('searches text bodies with snippets, filters by kind, and paginates by cursor', async () => {
    const root = freshRoot()
    await seed(root, 'demo', { name: 'a.md', content: 'kernel alpha' })
    await seed(root, 'demo', { name: 'b.md', content: 'kernel beta' })
    await seed(root, 'demo', { kind: 'code-graph', name: 'graph.json', format: 'json', content: '{"kernel":true}' })
    await seed(root, 'demo', { name: 'c.md', content: 'nothing relevant' })
    const runtime = createDevSpaceToolRuntime()
    const page = await runtime.search({ workspaceRoot: root, input: { query: 'kernel', limit: 20 } })
    expect(page.items.map(hit => hit.artifact.path).sort()).toEqual(['code-graph/graph.json', 'wiki/a.md', 'wiki/b.md'])
    expect(page.items.find(hit => hit.artifact.path === 'wiki/a.md')?.snippet).toContain('kernel alpha')
    const filtered = await runtime.search({ workspaceRoot: root, input: { query: 'kernel', kind: 'wiki', limit: 20 } })
    expect(filtered.items).toHaveLength(2)
    const first = await runtime.search({ workspaceRoot: root, input: { query: 'kernel', limit: 2 } })
    expect(first.items).toHaveLength(2)
    expect(first.totalEstimate).toBe(3)
    const second = await runtime.search({ workspaceRoot: root, input: { query: 'kernel', limit: 2, cursor: first.nextCursor! } })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeUndefined()
  })

  it('respects project and repository filters and rejects an empty query', async () => {
    const root = freshRoot()
    await seed(root, 'demo', { content: 'kernel one' })
    await seed(root, 'other', { content: 'kernel two' })
    const runtime = createDevSpaceToolRuntime()
    expect((await runtime.search({ workspaceRoot: root, input: { query: 'kernel', projectSlug: 'demo', limit: 20 } })).items).toHaveLength(1)
    expect((await runtime.search({ workspaceRoot: root, input: { query: 'kernel', repositoryId: 'repo_other', limit: 20 } })).items).toHaveLength(0)
    await expect(runtime.search({ workspaceRoot: root, input: { query: '   ', limit: 20 } }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})