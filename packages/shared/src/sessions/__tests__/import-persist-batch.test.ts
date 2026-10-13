import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverForeignSessions } from '../import-discover.ts'
import {
  defaultForeignPersistIo,
  listImportedSessionFiles,
  persistForeignSessions,
  type ForeignPersistIo,
} from '../import-persist.ts'
import { loadForeignImportRegistry } from '../import-registry.ts'

const dirs: string[] = []

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writeClaudeSources(home: string, count: number): string[] {
  const dir = join(home, '.claude', 'projects', 'fixture')
  mkdirSync(dir, { recursive: true })
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    const path = join(dir, `chat-${i}.jsonl`)
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `question ${i}` }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] } }),
      ].join('\n') + '\n',
    )
    paths.push(path)
  }
  return paths
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

function countingIo() {
  const counts = {
    registryLoads: 0,
    registryWrites: 0,
    scanCacheParses: 0,
    converts: [] as string[],
    headerReads: 0,
    bodyReads: [] as string[],
  }
  const io: ForeignPersistIo = {
    loadRegistry: (root) => {
      counts.registryLoads += 1
      return defaultForeignPersistIo.loadRegistry(root)
    },
    saveRegistry: (root, entries) => {
      counts.registryWrites += 1
      defaultForeignPersistIo.saveRegistry(root, entries)
    },
    loadScanCache: (root) => {
      counts.scanCacheParses += 1
      return defaultForeignPersistIo.loadScanCache(root)
    },
    convert: (sourcePath, kind) => {
      counts.converts.push(sourcePath)
      return defaultForeignPersistIo.convert(sourcePath, kind)
    },
    readSessionHeader: (file) => {
      counts.headerReads += 1
      return defaultForeignPersistIo.readSessionHeader(file)
    },
    readSessionFile: (file) => {
      counts.bodyReads.push(file)
      return defaultForeignPersistIo.readSessionFile(file)
    },
  }
  return { counts, io }
}

describe('batched foreign persist (ADR-0025)', () => {
  it('persists 150 new chats against 1,000 existing sessions without reading any session body', async () => {
    const home = tmp('persist-batch-home-')
    const workspace = tmp('persist-batch-ws-')
    const sources = writeClaudeSources(home, 150)
    writeExistingSessions(workspace, 1000)
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const { counts, io } = countingIo()
    const batches: string[][] = []

    const results = await persistForeignSessions(
      workspace,
      sources.map((sourcePath) => ({ sourcePath })),
      'skip',
      home,
      { io, onBatch: (batch) => { batches.push(batch.map((result) => result.sessionId ?? '')) } },
    )

    expect(results).toHaveLength(150)
    expect(results.every((result) => result.action === 'created')).toBe(true)
    expect(counts.bodyReads).toEqual([])
    expect(counts.headerReads).toBe(1000)
    expect(counts.scanCacheParses).toBe(1)
    expect(counts.registryLoads).toBe(1)
    expect(counts.registryWrites).toBeLessThanOrEqual(6)
    expect(counts.converts).toHaveLength(150)
    expect(batches.length).toBeLessThanOrEqual(6)
    expect(batches.flat()).toHaveLength(150)
    expect(Object.keys(loadForeignImportRegistry(workspace))).toHaveLength(150)
    expect(listImportedSessionFiles(workspace)).toHaveLength(1150)
  })

  it('skips already-imported chats without parsing their source or rewriting the registry', async () => {
    const home = tmp('persist-batch-home-')
    const workspace = tmp('persist-batch-ws-')
    const sources = writeClaudeSources(home, 30)
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const first = await persistForeignSessions(workspace, sources.map((sourcePath) => ({ sourcePath })), 'skip', home)
    const { counts, io } = countingIo()

    const second = await persistForeignSessions(workspace, sources.map((sourcePath) => ({ sourcePath })), 'skip', home, { io })

    expect(second.map((result) => result.reason)).toEqual(Array.from({ length: 30 }, () => 'already-imported'))
    expect(second.map((result) => result.sessionId)).toEqual(first.map((result) => result.sessionId))
    expect(counts.converts).toEqual([])
    expect(counts.registryWrites).toBe(0)
    expect(counts.bodyReads).toEqual([])
    expect(listImportedSessionFiles(workspace)).toHaveLength(30)
  })

  it('stops between batches on abort and leaves the registry equal to what was handed off', async () => {
    const home = tmp('persist-batch-home-')
    const workspace = tmp('persist-batch-ws-')
    const sources = writeClaudeSources(home, 60)
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const controller = new AbortController()
    const handedOff: string[] = []

    const results = await persistForeignSessions(workspace, sources.map((sourcePath) => ({ sourcePath })), 'skip', home, {
      signal: controller.signal,
      onBatch: (batch) => {
        for (const result of batch) if (result.sessionId) handedOff.push(result.sessionId)
        controller.abort()
      },
    })

    expect(results).toHaveLength(25)
    expect(handedOff).toHaveLength(25)
    const registry = loadForeignImportRegistry(workspace)
    expect(Object.values(registry).map((record) => record.sessionId).sort()).toEqual([...handedOff].sort())
    expect(listImportedSessionFiles(workspace)).toHaveLength(25)
  })

  it('yields to the event loop between batches', async () => {
    const home = tmp('persist-batch-home-')
    const workspace = tmp('persist-batch-ws-')
    const sources = writeClaudeSources(home, 5)
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const order: string[] = []

    await persistForeignSessions(workspace, sources.map((sourcePath) => ({ sourcePath })), 'skip', home, {
      batchSize: 2,
      onBatch: () => {
        order.push('batch')
        setImmediate(() => order.push('tick'))
      },
    })

    expect(order.slice(0, 5)).toEqual(['batch', 'tick', 'batch', 'tick', 'batch'])
  })
})
