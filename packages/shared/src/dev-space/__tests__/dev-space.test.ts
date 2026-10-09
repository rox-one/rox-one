import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { RPC_CHANNELS } from '../../protocol/channels'
import {
  devSpaceManifestEntryId,
  devSpaceRepositoryId,
  devSpaceRunId,
  type DevSpaceManifest,
  type DevSpaceRepositoryCatalog,
} from '../types'

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const HEX64 = /^[a-f0-9]{64}$/

describe('dev-space id helpers', () => {
  it('derives devrepo_/artifact_/devrun_ ids from sha256 of their inputs', () => {
    expect(devSpaceRepositoryId('ws', 'proj', 'repo_abc')).toBe(`devrepo_${sha256(['ws', 'proj', 'repo_abc'])}`)
    expect(devSpaceManifestEntryId('repo_abc', 'snapshot_1', 'wiki', 'wiki/index.md'))
      .toBe(`artifact_${sha256(['repo_abc', 'snapshot_1', 'wiki', 'wiki/index.md'])}`)
    expect(devSpaceRunId('repo_abc', 'snapshot_1', 'plan_1'))
      .toBe(`devrun_${sha256(['repo_abc', 'snapshot_1', 'plan_1'])}`)
  })

  it('produces hex-shaped, deterministic ids', () => {
    const id = devSpaceRepositoryId('ws', 'proj', 'repo_abc')
    expect(id.slice('devrepo_'.length)).toMatch(HEX64)
    expect(devSpaceRepositoryId('ws', 'proj', 'repo_abc')).toBe(id)
    expect(devSpaceManifestEntryId('repo_abc', 'snapshot_1', 'wiki', 'wiki/index.md').slice('artifact_'.length)).toMatch(HEX64)
    expect(devSpaceRunId('repo_abc', 'snapshot_1', 'plan_1').slice('devrun_'.length)).toMatch(HEX64)
  })

  it('separates ids that differ in any input (run id is idempotent per snapshot+plan)', () => {
    expect(devSpaceRepositoryId('ws', 'proj', 'repo_a')).not.toBe(devSpaceRepositoryId('ws', 'proj', 'repo_b'))
    expect(devSpaceManifestEntryId('repo', 'snap', 'wiki', 'a.md'))
      .not.toBe(devSpaceManifestEntryId('repo', 'snap', 'wiki', 'b.md'))
    expect(devSpaceManifestEntryId('repo', 'snap', 'wiki', 'a.md'))
      .not.toBe(devSpaceManifestEntryId('repo', 'snap', 'diagram', 'a.md'))
    expect(devSpaceRunId('repo', 'snap', 'plan_1')).not.toBe(devSpaceRunId('repo', 'snap', 'plan_2'))
    expect(devSpaceRunId('repo', 'snap', 'plan_1')).not.toBe(devSpaceRunId('repo', 'snap_2', 'plan_1'))
  })
})

describe('devSpace/podcast channel values', () => {
  const devSpaceValues = Object.values(RPC_CHANNELS.devSpace)
  const podcastValues = Object.values(RPC_CHANNELS.podcast)

  it('exposes the frozen devSpace ids with the devSpace: prefix', () => {
    expect(devSpaceValues).toEqual([
      'devSpace:listRepositories',
      'devSpace:addRepository',
      'devSpace:startClone',
      'devSpace:removeRepository',
      'devSpace:refreshRepository',
      'devSpace:cancel',
      'devSpace:capabilities',
      'devSpace:listRuns',
      'devSpace:startRun',
      'devSpace:listArtifacts',
      'devSpace:readArtifact',
      'devSpace:cloneProgress',
      'devSpace:changed',
      'devSpace:runProgress',
      'devSpace:softSignal',
    ])
  })

  it('has no duplicate values in devSpace or podcast blocks', () => {
    expect(new Set(devSpaceValues).size).toBe(devSpaceValues.length)
    expect(new Set(podcastValues).size).toBe(podcastValues.length)
    expect([...devSpaceValues, ...podcastValues].every(value => value.includes(':'))).toBe(true)
  })

  it('keeps podcast:job distinct from voice:job', () => {
    expect(RPC_CHANNELS.podcast.JOB).toBe('podcast:job')
    expect(RPC_CHANNELS.podcast.JOB).not.toBe(RPC_CHANNELS.voice.JOB)
  })
})

describe('dev-space catalog/manifest roundtrip', () => {
  it('preserves catalog and manifest through JSON serialization', () => {
    const repositoryId = 'repo_abc'
    const catalog: DevSpaceRepositoryCatalog = {
      schemaVersion: 1,
      repositories: [{
        schemaVersion: 1,
        id: devSpaceRepositoryId('ws', 'proj', repositoryId),
        repositoryId,
        workspaceId: 'ws',
        projectId: 'proj',
        projectSlug: 'my-project',
        origin: { kind: 'git-url', url: 'https://github.com/rox/rox', provider: 'github', defaultBranch: 'main' },
        displayName: 'rox',
        status: 'ready',
        createdAt: 1,
        updatedAt: 2,
        lastSnapshotId: 'snapshot_1',
        lastAnalyzedSnapshotId: 'snapshot_1',
      }],
    }
    const manifest: DevSpaceManifest = {
      schemaVersion: 1,
      repositoryId,
      snapshotId: 'snapshot_1',
      runId: devSpaceRunId(repositoryId, 'snapshot_1', 'plan_1'),
      entries: [{
        id: devSpaceManifestEntryId(repositoryId, 'snapshot_1', 'wiki', 'wiki/index.md'),
        kind: 'wiki',
        path: 'wiki/index.md',
        format: 'md',
        producedBy: { providerId: 'openwiki', version: '1.0.0' },
        sourceRevision: 'a'.repeat(40),
        createdAt: 3,
      }],
    }

    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog)
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })
})