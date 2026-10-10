import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearDevSpaceToolRuntime } from '@rox/session-tools-core'
import type { DevSpaceRepositoryRecord, DevSpaceRun } from '@rox/shared/dev-space'
import type { HandlerFn, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerDevSpaceHandlers, type HandlerEnvironment } from '../dev-space.ts'
import { clearDevSpaceStages, hasDevSpaceStage, runDevSpacePipeline } from '../../../devspace/runner.ts'
import { writeDevSpaceArtifact } from '../../../devspace/artifacts.ts'
import type { DevSpacePublishPort, DevSpacePublishWriteInput } from '../../../devspace/stages/publish.ts'

const roots: string[] = []
afterEach(() => {
  clearDevSpaceStages()
  clearDevSpaceToolRuntime()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const REPOSITORY_ID = `repo_${'a'.repeat(64)}`
const SNAPSHOT_ID = `snapshot_${'b'.repeat(64)}`
const RUN_ID = `devrun_${'c'.repeat(64)}`
const SLUG = 'demo'

function register(environment: Partial<HandlerEnvironment> = {}): void {
  const server = {
    handle(_channel: string, _handler: HandlerFn) { return undefined },
    push() { return undefined },
    onShutdown() { return () => {} },
  } as unknown as RpcServer
  const deps = {
    windowManager: { getWindowByWebContentsId: () => null, getWorkspaceForWindow: () => null },
  } as unknown as HandlerDeps
  registerDevSpaceHandlers(server, deps, {
    getWorkspace: () => null,
    loadProject: () => null,
    saveProject: () => {},
    loadProjectConfig: () => null,
    ...environment,
  })
}

function fixture(): { readonly root: string; readonly record: DevSpaceRepositoryRecord; readonly run: DevSpaceRun } {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-wiring-'))
  roots.push(root)
  const record: DevSpaceRepositoryRecord = {
    schemaVersion: 1, id: `devrepo_${'d'.repeat(64)}`, repositoryId: REPOSITORY_ID, workspaceId: 'ws',
    projectId: 'p1', projectSlug: SLUG, origin: { kind: 'local-folder', path: root },
    displayName: SLUG, status: 'ready', createdAt: 0, updatedAt: 0,
  }
  const run: DevSpaceRun = {
    schemaVersion: 1, id: RUN_ID, repositoryId: REPOSITORY_ID, snapshotId: SNAPSHOT_ID, stages: ['publish'],
    status: 'queued', progress: { stage: 'publish', done: 0, total: 1 }, startedAt: Date.now(),
    completedStages: [], artifacts: [],
  }
  return { root, record, run }
}

async function runPublish(root: string, record: DevSpaceRepositoryRecord, run: DevSpaceRun): Promise<void> {
  await writeDevSpaceArtifact({
    root, projectSlug: SLUG, repositoryId: REPOSITORY_ID, snapshotId: SNAPSHOT_ID, runId: RUN_ID,
    kind: 'wiki', name: 'index.md', format: 'md', content: '# Dev Space wiki\n',
    producedBy: { providerId: 'openwiki', version: '0.7.1' },
  })
  await runDevSpacePipeline({
    run, record, root, clientId: 'c', signal: new AbortController().signal, emit: () => {},
  })
}

describe('registerDevSpaceHandlers — stage wiring', () => {
  it('registers structural, llm and publish stages at handler start', () => {
    clearDevSpaceStages()
    register()
    expect(hasDevSpaceStage('structural')).toBe(true)
    expect(hasDevSpaceStage('llm')).toBe(true)
    expect(hasDevSpaceStage('publish')).toBe(true)
  })

  it('publishes through the host-supplied window-free port', async () => {
    const writes: DevSpacePublishWriteInput[] = []
    const port: DevSpacePublishPort = {
      read: async () => null,
      write: async input => {
        writes.push(input)
        return { status: 'committed', revision: `sha256:${'f'.repeat(64)}`, previousRevision: `sha256:${'0'.repeat(64)}`, operationId: input.operationId, committedAt: '2026-10-09T00:00:00.000Z' }
      },
    }
    clearDevSpaceStages()
    register({ publishPort: port })
    const { root, record, run } = fixture()
    await runPublish(root, record, run)
    expect(writes).toHaveLength(1)
    expect(writes[0]!.noteId).toBe('projects/demo/dev-space/wiki/index')
  })

  it('stays honest with publish-unavailable when the host composed no port', async () => {
    clearDevSpaceStages()
    register()
    const { root, record, run } = fixture()
    await runPublish(root, record, run)
    const audit = readFileSync(join(root, 'projects', SLUG, 'dev-space', 'audit.jsonl'), 'utf8')
    expect(audit).toContain('"event":"publish-unavailable"')
    expect(audit).toContain('"reason":"no-publish-port"')
  })
})