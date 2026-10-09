/**
 * c1.8 forget + lineage retention: forgetting a chunk id removes the corpus
 * line, the index chunk and embedding artifacts, and writes a content-free
 * lineage record that stays queryable through the audit surface. Forgetting an
 * already-forgotten id is a clean no-op.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLog } from '../AuditLog'
import { EpisodicMemory } from '../episodic-memory'
import { MemoryIndexService } from '../MemoryIndexService'
import { forgetMemoryChunks } from '../forget'

const roots: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-forget-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace(): string {
  const ws = tmp()
  mkdirSync(join(ws, 'memory', 'history'), { recursive: true })
  writeFileSync(join(ws, 'memory', 'context.md'), 'The office plants need watering every Monday.')
  writeFileSync(join(ws, 'memory', 'history', '2026-01-02.md'), 'Rolled back the deploy after the failed smoke test.')
  return ws
}

describe('forget (c1.8)', () => {
  test('removes the corpus line, the index chunk and embeddings, and records lineage', () => {
    const ws = workspace()
    const memoryDir = join(ws, 'memory')
    const index = new MemoryIndexService({ workspaceRoot: ws })
    const audit = new AuditLog('workspace', ws)
    const episodic = new EpisodicMemory(memoryDir)

    const contextText = 'The office plants need watering every Monday.'
    episodic.addEpisode({ kind: 'success', sessionId: 's1', text: contextText })

    const hits = index.search('watering').hits
    expect(hits).toHaveLength(1)
    const target = hits[0]!

    const result = forgetMemoryChunks({
      index,
      workspaceRoot: ws,
      audit,
      episodic,
      ids: [target.chunkId],
      by: 'agent',
      reason: 'user asked to forget the plant schedule',
      now: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect(result.forgotten).toEqual([target.chunkId])
    expect(result.alreadyForgotten).toEqual([])
    expect(result.lineage?.reason).toBe('user asked to forget the plant schedule')

    // 1. Corpus line is gone from the file store.
    expect(readFileSync(join(ws, 'memory', 'context.md'), 'utf8')).not.toContain('watering')
    // Untouched documents survive.
    expect(readFileSync(join(ws, 'memory', 'history', '2026-01-02.md'), 'utf8')).toContain('Rolled back the deploy')

    // 2. memory_search no longer returns the content; the chunk is unresolvable.
    expect(index.search('watering').hits).toEqual([])
    expect(index.get(target.chunkId)).toBeNull()

    // 3. Embedding artifact purged.
    expect(readFileSync(join(memoryDir, 'episodic.jsonl'), 'utf8')).not.toContain('watering')

    // Lineage retained + queryable through the audit surface, content-free.
    const forgetEntries = audit.read().filter((e) => e.action === 'forget')
    expect(forgetEntries).toHaveLength(1)
    expect(forgetEntries[0]!.detail).not.toContain('watering')
    expect(forgetEntries[0]!.target).toBe(target.chunkId)
    expect(forgetEntries[0]!.detail).toContain(target.chunkId)
  })

  test('forgetting an already-forgotten id is a clean no-op with no second lineage', () => {
    const ws = workspace()
    const index = new MemoryIndexService({ workspaceRoot: ws })
    const audit = new AuditLog('workspace', ws)

    const target = index.search('watering').hits[0]!
    forgetMemoryChunks({ index, workspaceRoot: ws, audit, ids: [target.chunkId], by: 'agent' })
    expect(audit.read().filter((e) => e.action === 'forget')).toHaveLength(1)

    const again = forgetMemoryChunks({ index, workspaceRoot: ws, audit, ids: [target.chunkId], by: 'agent' })
    expect(again.forgotten).toEqual([])
    expect(again.alreadyForgotten).toEqual([target.chunkId])
    expect(again.lineage).toBeNull()
    // No duplicate lineage for the no-op.
    expect(audit.read().filter((e) => e.action === 'forget')).toHaveLength(1)
  })

  test('a mixed batch forgets the resolvable ids and reports the rest as already forgotten', () => {
    const ws = workspace()
    const index = new MemoryIndexService({ workspaceRoot: ws })
    const audit = new AuditLog('workspace', ws)
    const target = index.search('deploy').hits[0]!

    const result = forgetMemoryChunks({
      index,
      workspaceRoot: ws,
      audit,
      ids: [target.chunkId, 'does-not-exist'],
      by: 'agent',
    })
    expect(result.forgotten).toEqual([target.chunkId])
    expect(result.alreadyForgotten).toEqual(['does-not-exist'])
    expect(index.search('deploy').hits).toEqual([])
  })

  test('forgets a lesson chunk by removing its line from lessons.jsonl', () => {
    const ws = workspace()
    const memoryDir = join(ws, 'memory')
    const line =
      '{"ts":"2026-01-01T00:00:00.000Z","rule":"Always run bun test","category":"preference","scope":"workspace","source":{"trigger":"explicit"}}'
    writeFileSync(join(memoryDir, 'lessons.jsonl'), `${line}\n`)
    const index = new MemoryIndexService({ workspaceRoot: ws })
    const audit = new AuditLog('workspace', ws)

    const target = index.search('bun').hits.find((h) => h.path === 'memory/lessons.jsonl')
    expect(target).toBeDefined()
    const result = forgetMemoryChunks({
      index,
      workspaceRoot: ws,
      audit,
      ids: [target!.chunkId],
      by: 'ui',
      reason: 'user revoked the rule',
    })
    expect(result.forgotten).toEqual([target!.chunkId])
    expect(readFileSync(join(memoryDir, 'lessons.jsonl'), 'utf8')).not.toContain('Always run bun test')
    expect(index.search('bun').hits.find((h) => h.path === 'memory/lessons.jsonl')).toBeUndefined()
  })
})