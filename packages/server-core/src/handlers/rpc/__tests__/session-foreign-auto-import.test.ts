import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultForeignPersistIo, loadForeignImportRegistry, type ForeignPersistIo } from '@rox/shared/sessions'
import type { HandlerDeps } from '../../handler-deps'
import { ForeignAutoImporter } from '../session-foreign-auto-import'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function writeClaudeSources(home: string, count: number): void {
  const dir = join(home, '.claude', 'projects', 'fixture')
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(dir, `chat-${i}.jsonl`),
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `question ${i}` }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] } }),
      ].join('\n') + '\n',
    )
  }
}

function writeExistingSessions(workspace: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = `260101-existing-${i}`
    const dir = join(workspace, 'sessions', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.jsonl'),
      `${JSON.stringify({ id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, messageCount: 1 })}\n` +
        `${JSON.stringify({ id: 'm1', type: 'user', content: 'existing body' })}\n`,
    )
  }
}

function fakeSessionManager(onIngest?: (workspaceId: string, sessionIds: readonly string[]) => void) {
  const ingests: Array<{ workspaceId: string; sessionIds: string[] }> = []
  const sessionManager = {
    ingestImportedSessions: (workspaceId: string, sessionIds: readonly string[]) => {
      ingests.push({ workspaceId, sessionIds: [...sessionIds] })
      onIngest?.(workspaceId, sessionIds)
      return []
    },
  }
  return { ingests, deps: { sessionManager } as unknown as HandlerDeps }
}

function countingIo() {
  const counts = { registryWrites: 0, bodyReads: 0 }
  const io: Partial<ForeignPersistIo> = {
    saveRegistry: (root, entries) => {
      counts.registryWrites += 1
      defaultForeignPersistIo.saveRegistry(root, entries)
    },
    readSessionFile: (file) => {
      counts.bodyReads += 1
      return defaultForeignPersistIo.readSessionFile(file)
    },
  }
  return { counts, io }
}

describe('ForeignAutoImporter batched run (ADR-0025)', () => {
  it('imports 150 new chats next to 1,000 sessions in at most 6 batches with no session body reads', async () => {
    const home = scratch('auto-import-home-')
    const rootPath = scratch('auto-import-ws-')
    writeClaudeSources(home, 150)
    writeExistingSessions(rootPath, 1000)
    const { ingests, deps } = fakeSessionManager()
    const { counts, io } = countingIo()
    const importer = new ForeignAutoImporter(deps, {
      homeDir: home,
      resolveWorkspace: (id) => (id === undefined || id === 'ws' ? { id: 'ws', rootPath } : null),
      persistIo: io,
    })

    const status = await importer.run({ workspaceId: 'ws', force: true })

    expect(status).toMatchObject({ state: 'done', imported: 150, failed: 0 })
    expect(counts.bodyReads).toBe(0)
    expect(counts.registryWrites).toBeLessThanOrEqual(6)
    expect(ingests.length).toBeLessThanOrEqual(6)
    expect(ingests.every((ingest) => ingest.workspaceId === 'ws')).toBe(true)
    expect(ingests.flatMap((ingest) => ingest.sessionIds)).toHaveLength(150)
  })

  it('stops between batches when consent is revoked and keeps the registry equal to the ingested sessions', async () => {
    const home = scratch('auto-import-home-')
    const rootPath = scratch('auto-import-ws-')
    writeClaudeSources(home, 60)
    let importer: ForeignAutoImporter | undefined
    const { ingests, deps } = fakeSessionManager(() => { importer?.setEnabled('ws', false) })
    importer = new ForeignAutoImporter(deps, {
      homeDir: home,
      resolveWorkspace: (id) => (id === undefined || id === 'ws' ? { id: 'ws', rootPath } : null),
    })

    const status = await importer.run({ workspaceId: 'ws', force: true })

    expect(ingests).toHaveLength(1)
    expect(ingests[0]!.sessionIds).toHaveLength(25)
    expect(status).toMatchObject({ state: 'partial', partialReason: 'consent-revoked', imported: 25, remaining: 35 })
    const registered = Object.values(loadForeignImportRegistry(rootPath)).map((record) => record.sessionId).sort()
    expect(registered).toEqual([...ingests[0]!.sessionIds].sort())
  })

  it('never runs two workspaces at the same time', async () => {
    const home = scratch('auto-import-home-')
    const first = scratch('auto-import-ws-')
    const second = scratch('auto-import-ws-')
    writeClaudeSources(home, 30)
    const { ingests, deps } = fakeSessionManager()
    const workspaces: Record<string, { id: string; rootPath: string }> = {
      one: { id: 'one', rootPath: first },
      two: { id: 'two', rootPath: second },
    }
    const importer = new ForeignAutoImporter(deps, { homeDir: home, resolveWorkspace: (id) => (id ? workspaces[id] : null) })

    await Promise.all([
      importer.run({ workspaceId: 'one', force: true }),
      importer.run({ workspaceId: 'two', force: true }),
    ])

    expect(ingests.map((ingest) => ingest.workspaceId)).toEqual(['one', 'one', 'two', 'two'])
  })
})
