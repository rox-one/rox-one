import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devSpaceManifestEntryId } from '@rox/shared/dev-space'
import {
  defaultDevSpaceConsent, devSpaceArtifactDirectory, readDevSpaceArtifact, readDevSpaceConsent, readDevSpaceManifest,
  writeDevSpaceArtifact, writeDevSpaceConsent,
} from '../artifacts.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-artifacts-'))
  roots.push(root)
  return root
}

const repositoryId = `repo_${'b'.repeat(64)}`
const snapshotId = `snapshot_${'c'.repeat(64)}`
const runId = `devrun_${'a'.repeat(64)}`

function write(root: string, overrides: Partial<Parameters<typeof writeDevSpaceArtifact>[0]> = {}) {
  return writeDevSpaceArtifact({
    root, projectSlug: 'demo', repositoryId, snapshotId, runId,
    kind: 'wiki', name: 'index.md', format: 'md', content: '# Hello',
    producedBy: { providerId: 'openwiki', version: '1.2.3' }, sourceRevision: 'd'.repeat(40),
    ...overrides,
  })
}

describe('devSpace artifact store', () => {
  it('writes an artifact into its kind directory and registers it in the manifest', async () => {
    const root = freshRoot()
    const entry = await write(root)
    expect(entry.id).toBe(devSpaceManifestEntryId(repositoryId, snapshotId, 'wiki', 'wiki/index.md'))
    expect(entry).toMatchObject({ kind: 'wiki', path: 'wiki/index.md', format: 'md', producedBy: { providerId: 'openwiki', version: '1.2.3' } })
    expect(readFileSync(join(root, 'projects', 'demo', 'dev-space', 'wiki', 'index.md'), 'utf8')).toBe('# Hello')
    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest).toMatchObject({ schemaVersion: 1, repositoryId, snapshotId, runId })
    expect(manifest?.entries).toEqual([entry])
    expect(await readDevSpaceArtifact(root, 'demo', entry)).toBe('# Hello')
  })

  it('maps kinds to their on-disk directories', () => {
    const root = freshRoot()
    expect(devSpaceArtifactDirectory(root, 'demo', 'diagram')).toBe(join(root, 'projects', 'demo', 'dev-space', 'diagrams'))
    expect(devSpaceArtifactDirectory(root, 'demo', 'tour')).toContain(join('dev-space', 'tours'))
    expect(devSpaceArtifactDirectory(root, 'demo', 'sbom-cve')).toContain(join('dev-space', 'security'))
  })

  it('replaces rather than duplicates a manifest row for the same entry id', async () => {
    const root = freshRoot()
    await write(root, { content: '# v1' })
    await write(root, { content: '# v2' })
    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries).toHaveLength(1)
    expect(await readDevSpaceArtifact(root, 'demo', manifest!.entries[0]!)).toBe('# v2')
  })

  it('starts a fresh manifest set when the snapshot/run identity changes', async () => {
    const root = freshRoot()
    await write(root)
    await write(root, { snapshotId: `snapshot_${'f'.repeat(64)}`, runId: `devrun_${'9'.repeat(64)}`, name: 'next.md' })
    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries.map(entry => entry.path)).toEqual(['wiki/next.md'])
  })

  it('rejects traversal in artifact names and returns null for an absent manifest', async () => {
    const root = freshRoot()
    expect(await readDevSpaceManifest(root, 'demo')).toBeNull()
    await expect(write(root, { name: '../escape.md' })).rejects.toThrow()
  })

  it('round-trips per-repo consent and defaults it closed', async () => {
    const root = freshRoot()
    const consent = defaultDevSpaceConsent(repositoryId, 42)
    expect(consent.items).toEqual({ modelConnectors: false, cveNetwork: false, toolUpdates: false })
    await writeDevSpaceConsent(root, 'demo', consent)
    expect(await readDevSpaceConsent(root, 'demo')).toEqual(consent)
    expect(await readDevSpaceConsent(root, 'other')).toBeNull()
  })
})