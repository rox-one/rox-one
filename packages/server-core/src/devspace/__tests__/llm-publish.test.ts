import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { readDevSpaceManifest, writeDevSpaceArtifact, writeDevSpaceConsent } from '../artifacts.ts'
import { clearDevSpaceStages, hasDevSpaceStage } from '../runner.ts'
import { registerDevSpaceLlmStage, runLlmStage, type LlmAdapter, type LlmSourceFile } from '../stages/llm.ts'
import { registerDevSpacePublishStage, runPublishStage, type DevSpacePublishPort, type DevSpacePublishWriteInput, type DevSpacePublishWriteResult } from '../stages/publish.ts'

const roots: string[] = []
afterEach(() => {
  clearDevSpaceStages()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-llm-publish-'))
  roots.push(root)
  return root
}

const repositoryId = `repo_${'b'.repeat(64)}`
const snapshotId = `snapshot_${'c'.repeat(64)}`
const runId = `devrun_${'a'.repeat(64)}`
const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

function record(): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1, id: `devrepo_${'e'.repeat(64)}`, repositoryId, workspaceId: 'ws', projectId: 'proj', projectSlug: 'demo',
    origin: { kind: 'local-folder', path: '/tmp/demo' }, displayName: 'demo', status: 'bound', createdAt: 1, updatedAt: 2,
  }
}

function stageContext(root: string, cwd?: string) {
  const rec = record()
  return {
    runId, repositoryId, snapshotId, workspaceId: 'ws', projectSlug: 'demo', root,
    record: cwd ? { ...rec, origin: { kind: 'local-folder', path: cwd } as const } : rec,
    signal: new AbortController().signal, report: () => {},
  }
}

async function auditEvents(root: string): Promise<Array<Record<string, unknown>>> {
  try {
    return readFileSync(join(root, 'projects', 'demo', 'dev-space', 'audit.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  } catch { return [] }
}

async function grantConsent(root: string, modelConnectors: boolean): Promise<void> {
  await writeDevSpaceConsent(root, 'demo', {
    schemaVersion: 1, repositoryId, items: { modelConnectors, cveNetwork: false, toolUpdates: false }, grantedAt: 1, updatedAt: 1,
  })
}

// ---------------------------------------------------------------------------
// llm stage
// ---------------------------------------------------------------------------

describe('devSpace llm stage — egress consent gate', () => {
  it('stops partial without touching an adapter when modelConnectors is false', async () => {
    const root = freshRoot()
    await grantConsent(root, false)
    let called = false
    const adapter: LlmAdapter = {
      id: 'openwiki', kind: 'wiki', version: '0.7.1',
      detect: async () => { called = true; return { available: true } },
      generate: async () => { called = true; return { status: 'unavailable' } },
    }
    const outcome = await runLlmStage([adapter], stageContext(root))
    expect(outcome?.partial).toBe(true)
    expect(called).toBe(false)
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'llm-egress-denied', reason: 'consent-denied' }))
  })

  it('records consent-missing when no consent file exists', async () => {
    const outcome = await runLlmStage([], stageContext(freshRoot()))
    expect(outcome?.partial).toBe(true)
  })
})

describe('devSpace llm stage — unavailable and masking', () => {
  it('reports a missing tool as unavailable and finishes partial without artifacts', async () => {
    const root = freshRoot()
    await grantConsent(root, true)
    const adapter: LlmAdapter = {
      id: 'understand-anything', kind: 'understanding', version: '1d7418b8',
      detect: async () => ({ available: false, detail: 'harness not composed' }),
      generate: async () => ({ status: 'ok', artifacts: [] }),
    }
    const outcome = await runLlmStage([adapter], stageContext(root))
    expect(outcome?.partial).toBe(true)
    expect(outcome?.artifacts ?? []).toEqual([])
    expect(await readDevSpaceManifest(root, 'demo')).toBeNull()
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'llm-adapter', status: 'skip', reason: 'unavailable' }))
  })

  it('masks secrets and drops excluded/binary files before egress, then records provenance', async () => {
    const root = freshRoot()
    await grantConsent(root, true)
    const cwd = freshRoot()
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'app.ts'), 'const password = "hunter2secret"\nexport const ok = true\n')
    writeFileSync(join(cwd, '.env'), 'API_KEY=sk-abcdefgh12345678\n')
    writeFileSync(join(cwd, 'src', 'server.pem'), '-----BEGIN PRIVATE KEY-----\nzzz\n')
    writeFileSync(join(cwd, 'src', 'blob.bin'), 'a\u0000b')

    let sources: readonly LlmSourceFile[] = []
    const adapter: LlmAdapter = {
      id: 'openwiki', kind: 'wiki', version: '0.7.1',
      detect: async () => ({ available: true }),
      generate: async input => {
        sources = input.sources
        return { status: 'ok', artifacts: [{ name: 'index.md', format: 'md', content: '# Wiki' }] }
      },
    }
    const outcome = await runLlmStage([adapter], stageContext(root, cwd))
    expect(outcome?.partial).toBeFalsy()

    const app = sources.find(source => source.path === 'src/app.ts')
    expect(app).toBeDefined()
    expect(app?.content).toContain('[redacted]')
    expect(app?.content).not.toContain('hunter2secret')
    expect(sources.some(source => source.path === '.env')).toBe(false)
    expect(sources.some(source => source.path.endsWith('.pem'))).toBe(false)
    expect(sources.some(source => source.path.endsWith('.bin'))).toBe(false)

    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries).toHaveLength(1)
    expect(manifest?.entries[0]).toMatchObject({ kind: 'wiki', path: 'wiki/index.md', producedBy: { providerId: 'openwiki', version: '0.7.1' } })
  })

  it('registers through the stage registry only', () => {
    expect(hasDevSpaceStage('llm')).toBe(false)
    registerDevSpaceLlmStage([])
    expect(hasDevSpaceStage('llm')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// publish stage
// ---------------------------------------------------------------------------

function publishedPage(body: string, bodyDigest: string): string {
  return `${body}\n\n<!-- rox-devspace: provider=openwiki@0.7.1 artifact=artifact_x body=${bodyDigest} -->\n`
}

async function seedWikiArtifact(root: string, content: string): Promise<void> {
  await writeDevSpaceArtifact({
    root, projectSlug: 'demo', repositoryId, snapshotId, runId,
    kind: 'wiki', name: 'index.md', format: 'md', content, producedBy: { providerId: 'openwiki', version: '0.7.1' },
  })
}

function publishPort(overrides: Partial<DevSpacePublishPort> = {}): { readonly port: DevSpacePublishPort; readonly writes: DevSpacePublishWriteInput[] } {
  const writes: DevSpacePublishWriteInput[] = []
  const port: DevSpacePublishPort = {
    read: async () => null,
    write: async input => {
      writes.push(input)
      return { status: 'committed', revision: `sha256:${'f'.repeat(64)}`, previousRevision: `sha256:${'1'.repeat(64)}`, operationId: input.operationId, committedAt: '2026-10-09T00:00:00.000Z' }
    },
    ...overrides,
  }
  return { port, writes }
}

describe('devSpace publish stage', () => {
  it('publishes a fresh page with a durable receipt and no shell/egress', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const { port, writes } = publishPort()
    const outcome = await runPublishStage(port, stageContext(root))
    expect(outcome?.partial).toBeFalsy()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.noteId).toBe('projects/demo/dev-space/wiki/index')
    expect(writes[0]!.expectedRevision).toBeNull()
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'publish', noteId: 'projects/demo/dev-space/wiki/index', status: 'ok' }))
  })

  it('never overwrites a user-edited page — it marks the conflict', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const { port, writes } = publishPort({
      read: async () => ({ revision: `sha256:${'2'.repeat(64)}`, content: publishedPage('# Edited by user', sha('# Doc')) }),
    })
    const outcome = await runPublishStage(port, stageContext(root))
    expect(outcome?.partial).toBe(true)
    expect(writes).toHaveLength(0)
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'publish-conflict', reason: 'user-edit' }))
  })

  it('treats a page without our marker as foreign and leaves it untouched', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const { port, writes } = publishPort({ read: async () => ({ revision: `sha256:${'3'.repeat(64)}`, content: '# Hand-written' }) })
    const outcome = await runPublishStage(port, stageContext(root))
    expect(outcome?.partial).toBe(true)
    expect(writes).toHaveLength(0)
  })

  it('re-publishes its own unmodified output using optimistic concurrency', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const existing = publishedPage('# Doc', sha('# Doc'))
    const { port, writes } = publishPort({ read: async () => ({ revision: `sha256:${'4'.repeat(64)}`, content: existing }) })
    const outcome = await runPublishStage(port, stageContext(root))
    expect(outcome?.partial).toBeFalsy()
    expect(writes[0]!.expectedRevision).toBe(`sha256:${'4'.repeat(64)}`)
  })

  const writeFailures: ReadonlyArray<readonly [string, DevSpacePublishWriteResult, string]> = [
    ['conflict', { status: 'conflict', currentRevision: `sha256:${'5'.repeat(64)}` }, 'publish-conflict'],
    ['busy', { status: 'busy' }, 'publish-error'],
    ['denied', { status: 'denied' }, 'publish-error'],
    ['unavailable', { status: 'unavailable', detail: 'no pipeline' }, 'publish-error'],
  ]
  for (const [caseName, writeResult, expectedEvent] of writeFailures) {
    it(`records a ${caseName} commit failure in the audit instead of failing the run`, async () => {
      const root = freshRoot()
      await seedWikiArtifact(root, '# Doc')
      const { port } = publishPort({ write: async input => ({ ...writeResult, operationId: input.operationId }) as DevSpacePublishWriteResult })
      const outcome = await runPublishStage(port, stageContext(root))
      expect(outcome?.partial).toBe(true)
      expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: expectedEvent }))
    })
  }

  it('stays partial with an explicit audit reason when no port is composed', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const outcome = await runPublishStage(undefined, stageContext(root))
    expect(outcome?.partial).toBe(true)
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'publish-unavailable', reason: 'no-publish-port' }))
  })

  it('refuses to publish a manifest from another snapshot', async () => {
    const root = freshRoot()
    await seedWikiArtifact(root, '# Doc')
    const context = { ...stageContext(root), snapshotId: `snapshot_${'9'.repeat(64)}` }
    const { port, writes } = publishPort()
    const outcome = await runPublishStage(port, context)
    expect(outcome?.partial).toBe(true)
    expect(writes).toHaveLength(0)
    expect(await auditEvents(root)).toContainEqual(expect.objectContaining({ event: 'publish-skip', reason: 'manifest-snapshot-mismatch' }))
  })

  it('registers through the stage registry only', () => {
    expect(hasDevSpaceStage('publish')).toBe(false)
    registerDevSpacePublishStage()
    expect(hasDevSpaceStage('publish')).toBe(true)
  })
})