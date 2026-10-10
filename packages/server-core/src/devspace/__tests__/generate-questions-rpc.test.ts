/**
 * `devSpace:generateQuestions` handler (03-SPEC-features §3, D8): consent gates,
 * idempotency, artifact provenance and honest security degradation.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getDefaultEnvironmentPrefs } from '@rox/shared/environment'
import { clearDevSpaceToolRuntime } from '@rox/session-tools-core'
import type { DevSpaceGenerateQuestionsResult, DevSpaceManifestEntry } from '@rox/shared/dev-space'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handlers/handler-deps.ts'
import { registerDevSpaceHandlers, type HandlerEnvironment } from '../../handlers/rpc/dev-space.ts'
import { clearDevSpaceStages } from '../runner.ts'
import { readDevSpaceArtifact, readDevSpaceManifest, writeDevSpaceConsent } from '../artifacts.ts'
import type { DevSpaceSecurityScan, DevSpaceSecurityScanInput } from '../security/sbom-cve.ts'

const roots: string[] = []
afterEach(() => {
  clearDevSpaceStages()
  clearDevSpaceToolRuntime()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SNAPSHOT_ID = `snapshot_${'a'.repeat(64)}`

const FULL_SECURITY: DevSpaceSecurityScan = {
  summary: {
    sbom: { status: 'ok', packageCount: 2 },
    cve: { status: 'ok', vulnerabilityCount: 1 },
    reasons: [],
  },
  artifacts: [
    { name: 'sbom.json', format: 'json', content: '{"artifacts":[]}', producedBy: { providerId: 'syft', version: '1.9.0' } },
    { name: 'cve.json', format: 'json', content: '{"vulnerabilities":[]}', producedBy: { providerId: 'osv', version: 'v1' } },
  ],
}

const DEGRADED_SECURITY: DevSpaceSecurityScan = {
  summary: {
    sbom: { status: 'unavailable', packageCount: 0, reason: 'syft-unavailable' },
    cve: { status: 'skipped', vulnerabilityCount: 0, reason: 'sbom-unavailable' },
    reasons: ['syft-unavailable'],
  },
  artifacts: [
    { name: 'security-summary.json', format: 'json', content: JSON.stringify({}), producedBy: { providerId: 'devspace-security', version: '1' } },
  ],
}

interface FixtureOptions {
  readonly runSecurityScan?: HandlerEnvironment['runSecurityScan']
}

interface Fixture {
  readonly root: string
  readonly handlers: Map<string, HandlerFn>
  readonly configs: Map<string, { id: string; slug: string; name: string; createdAt: number; updatedAt: number }>
  readonly securityInputs: Array<{ cwd: string; cveNetwork: boolean }>
  call(channel: string): (input: unknown) => Promise<unknown>
}

function fixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-questions-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const configs = new Map<string, { id: string; slug: string; name: string; createdAt: number; updatedAt: number }>()
  const securityInputs: Array<{ cwd: string; cveNetwork: boolean }> = []
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() { return undefined },
    onShutdown() { return () => {} },
  } as unknown as RpcServer
  const deps = {
    windowManager: {
      getWindowByWebContentsId: (id: number) => (id === 1 ? {} : null),
      getWorkspaceForWindow: (id: number) => (id === 1 ? 'ws' : null),
    },
  } as unknown as HandlerDeps
  registerDevSpaceHandlers(server, deps, {
    getWorkspace: id => (id === 'ws' ? { id, rootPath: root } : null),
    loadProject: () => null,
    saveProject: (_root, config) => { configs.set(config.slug, config as never) },
    loadProjectConfig: (_root, slug) => (configs.get(slug) ?? null) as never,
    structuralAdapters: [],
    llmAdapters: [],
    reconcile: async () => ({ snapshotId: SNAPSHOT_ID }),
    readEnvironmentPrefs: () => getDefaultEnvironmentPrefs(0),
    runSecurityScan: async input => {
      securityInputs.push({ cwd: input.cwd, cveNetwork: input.cveNetwork })
      const scan = options.runSecurityScan ?? (async (_input: DevSpaceSecurityScanInput) => FULL_SECURITY)
      return scan(input)
    },
  })
  const context: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (channel: string) => (input: unknown) => Promise.resolve().then(() => handlers.get(channel)!(context, input))
  return { root, handlers, configs, securityInputs, call }
}

async function addRepository(f: Fixture): Promise<{ id: string; repositoryId: string; projectSlug: string }> {
  return await f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
    workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
  }) as { id: string; repositoryId: string; projectSlug: string }
}

function grantConsent(f: Fixture, repositoryId: string, slug: string, cveNetwork: boolean): void {
  writeDevSpaceConsent(f.root, slug, {
    schemaVersion: 1, repositoryId,
    items: { modelConnectors: true, cveNetwork, toolUpdates: false }, grantedAt: 1, updatedAt: 1,
  })
}

describe('devSpace:generateQuestions — consent gate', () => {
  it('returns a typed denial with a reason and writes no artifact when consent is missing', async () => {
    const f = fixture()
    const record = await addRepository(f)
    const result = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    expect(result.status).toBe('denied')
    expect(result.blocks).toEqual([])
    expect(result.artifacts).toEqual([])
    expect(result.reasons).toEqual(['consent-missing'])
    expect(await readDevSpaceManifest(f.root, record.projectSlug)).toBeNull()
    const audit = readFileSync(join(f.root, 'projects', record.projectSlug, 'dev-space', 'audit.jsonl'), 'utf8')
    expect(audit).toContain('questions-egress-denied')
  })

  it('denies when modelConnectors is explicitly false', async () => {
    const f = fixture()
    const record = await addRepository(f)
    writeDevSpaceConsent(f.root, record.projectSlug, {
      schemaVersion: 1, repositoryId: record.repositoryId,
      items: { modelConnectors: false, cveNetwork: true, toolUpdates: false }, grantedAt: 1, updatedAt: 1,
    })
    const result = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    expect(result.status).toBe('denied')
    expect(result.reasons).toEqual(['model-consent-denied'])
  })
})

describe('devSpace:generateQuestions — generation and idempotency', () => {
  it('generates three blocks, writes the questions artifact first, and passes consent to the scanner', async () => {
    const f = fixture()
    const record = await addRepository(f)
    grantConsent(f, record.repositoryId, record.projectSlug, true)

    const result = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    expect(result.status).toBe('ok')
    expect(result.blocks.map(block => block.block)).toEqual(['learn', 'features', 'security'])
    for (const block of result.blocks) expect(block.questions).toHaveLength(10)
    expect(result.snapshotId).toBe(SNAPSHOT_ID)
    // The CVE network consent is forwarded to the scanner (egress gating).
    expect(f.securityInputs).toEqual([{ cwd: expect.any(String), cveNetwork: true }])

    const manifest = await readDevSpaceManifest(f.root, record.projectSlug)
    expect(manifest!.entries).toHaveLength(3)
    expect(manifest!.entries[0]!.kind).toBe('questions')
    expect(new Set(manifest!.entries.map(entry => entry.kind))).toEqual(new Set(['questions', 'sbom-cve']))
    expect(manifest!.entries.find(entry => entry.kind === 'questions')!.producedBy).toEqual({ providerId: 'devspace-questions', version: '1' })

    const questionsEntry = manifest!.entries.find(entry => entry.kind === 'questions') as DevSpaceManifestEntry
    const parsed = JSON.parse(await readDevSpaceArtifact(f.root, record.projectSlug, questionsEntry))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.repositoryId).toBe(record.repositoryId)
    expect(parsed.blocks).toHaveLength(3)
    expect(parsed.security.cve.status).toBe('ok')
  })

  it('is idempotent: a rerun over the same snapshot replaces the same manifest rows', async () => {
    const f = fixture()
    const record = await addRepository(f)
    grantConsent(f, record.repositoryId, record.projectSlug, false)

    const first = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    const firstIds = first.artifacts.map(artifact => artifact.id).sort()
    const second = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    const secondIds = second.artifacts.map(artifact => artifact.id).sort()
    expect(secondIds).toEqual(firstIds)
    expect((await readDevSpaceManifest(f.root, record.projectSlug))!.entries).toHaveLength(3)
    // Second call forwarded cveNetwork=false, mirroring the consent.
    expect(f.securityInputs.map(input => input.cveNetwork)).toEqual([false, false])
  })
})

describe('devSpace:generateQuestions — security degradation', () => {
  it('reports partial with a reason when syft is unavailable, without failing generation', async () => {
    const f = fixture({ runSecurityScan: async () => DEGRADED_SECURITY })
    const record = await addRepository(f)
    grantConsent(f, record.repositoryId, record.projectSlug, true)

    const result = await f.call(RPC_CHANNELS.devSpace.GENERATE_QUESTIONS)({ workspaceId: 'ws', repositoryId: record.id }) as DevSpaceGenerateQuestionsResult
    expect(result.status).toBe('partial')
    expect(result.reasons).toEqual(['syft-unavailable'])
    expect(result.security.sbom.reason).toBe('syft-unavailable')
    expect(result.security.cve.reason).toBe('sbom-unavailable')
    expect(result.blocks).toHaveLength(3)
    const manifest = await readDevSpaceManifest(f.root, record.projectSlug)
    expect(manifest!.entries.some(entry => entry.kind === 'sbom-cve')).toBe(true)
    expect(existsSync(join(f.root, 'projects', record.projectSlug, 'dev-space', 'security', 'security-summary.json'))).toBe(true)
  })
})