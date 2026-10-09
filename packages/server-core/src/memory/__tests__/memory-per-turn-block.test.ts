/**
 * c1.4 residual — the per-turn memory payload (c1.5 recall + c1.6 standing
 * intents only).
 *
 * Exercises the exact composition SessionManager hands to
 * `BackendConfig.getPerTurnMemoryBlock`: `buildMemoryBlocks` for THIS turn's
 * message, then `formatPerTurnMemoryBlock`. The curated bootstrap and the other
 * spawn-time blocks must never ride the per-turn path; untrusted chunks never
 * appear; a standing intent fires once per turn.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import type { MemoryConfig, MemoryChunkProvenance } from '@rox/shared/memory/types'
import { DEFAULT_MEMORY_CONFIG } from '@rox/shared/memory/types'
import { formatPerTurnMemoryBlock } from '@rox/shared/memory/context-select'
import { MemoryService } from '../MemoryService'
import { MemoryFileStore } from '../MemoryFileStore'
import { LessonStore } from '../LessonStore'
import { StandingIntentStore } from '../StandingIntentStore'
import { resetMemoryIndexServiceCache } from '../MemoryIndexService'

const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
  resetMemoryIndexServiceCache()
})

const OWNER: MemoryChunkProvenance = { originClass: 'owner', sessionKind: 'interactive', observedAt: '2026-01-01T00:00:00.000Z' }
const UNTRUSTED: MemoryChunkProvenance = { originClass: 'untrusted', sessionKind: 'unknown', observedAt: '2026-01-01T00:00:00.000Z' }

const RECALL_HEADER = '[Recalled memory'
const INTENT_HEADER = '[Standing intentions'
const BOOTSTRAP_HEADER = '[Curated memory'

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

function makeService() {
  const root = mkdtempSync(join(tmpdir(), 'mempt-'))
  roots.push(root)
  const wsFiles = new MemoryFileStore('workspace', root)
  const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
  const globalLessons = new LessonStore(new MemoryFileStore('global', root, join(root, 'global-config')).lessonsPath, 'global')
  const intentStore = new StandingIntentStore(wsFiles.intentsPath)
  const config: MemoryConfig = { ...DEFAULT_MEMORY_CONFIG }
  const svc = new MemoryService({
    workspaceRoot: root,
    workspaceId: 'ws-1',
    lessonStoreFactory: (scope) => (scope === 'global' ? globalLessons : wsLessons),
    fileStore: wsFiles,
    standingIntentStore: intentStore,
    getConfig: () => config,
    logger: { warn: () => {} },
  })
  return { svc, root, wsFiles, intentStore }
}

describe('formatPerTurnMemoryBlock — only the per-turn additions', () => {
  it('renders recall + intent and never the spawn-time blocks', () => {
    const out = formatPerTurnMemoryBlock({
      bootstrapBlock: `${BOOTSTRAP_HEADER}\n## projects/demo/MEMORY.md\nDeploy previews.`,
      lessonsBlock: '[Learned corrections]',
      memoryBlock: '[Workspace memory]',
      sourcesBlock: '[Retrieved source docs]',
      recallBlock: `${RECALL_HEADER} — matched this message.]\n- chunk body (Source: memory/context.md#L1)`,
      intentBlock: `${INTENT_HEADER} — you committed to these.]\n- run the ledger tests`,
    })!
    expect(out).toContain(RECALL_HEADER)
    expect(out).toContain(INTENT_HEADER)
    expect(out).not.toContain(BOOTSTRAP_HEADER)
    expect(out).not.toContain('[Learned corrections]')
    expect(out).not.toContain('[Workspace memory]')
    expect(out).not.toContain('[Retrieved source docs]')
  })

  it('returns null when neither lane produced a block', () => {
    expect(formatPerTurnMemoryBlock(undefined)).toBeNull()
    expect(formatPerTurnMemoryBlock({ bootstrapBlock: BOOTSTRAP_HEADER })).toBeNull()
  })
})

describe('c1.4 residual per-turn block (real MemoryService)', () => {
  it('carries a trusted recall once per turn and never the spawn-time bootstrap', async () => {
    const h = makeService()
    // Spawn-time bootstrap document (agent provenance ⇒ eligible for injection).
    mkdirSync(join(h.root, 'projects', 'demo'), { recursive: true })
    writeFileSync(join(h.root, 'projects', 'demo', 'MEMORY.md'), 'Spawn-time curated bootstrap body.\n')
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline every time.')

    const blocks = await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline', sessionId: 's1' })
    expect(blocks?.bootstrapBlock).toContain('Spawn-time curated bootstrap body.')

    const perTurn = formatPerTurnMemoryBlock(blocks)!
    expect(count(perTurn, RECALL_HEADER)).toBe(1)
    expect(perTurn).toContain('vercel pipeline')
    expect(perTurn).not.toContain('Spawn-time curated bootstrap body.')

    // "Second turn": re-resolving the same message per turn still carries the
    // recall block exactly once — there is no spawn-time re-injection path.
    const secondTurn = formatPerTurnMemoryBlock(
      await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline', sessionId: 's1' }),
    )!
    expect(count(secondTurn, RECALL_HEADER)).toBe(1)
    expect(secondTurn).not.toContain('Spawn-time curated bootstrap body.')
  })

  it('never lets an untrusted chunk into the per-turn block', async () => {
    const h = makeService()
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline every time.')
    writeFileSync(join(h.root, 'memory', 'index-provenance.json'), JSON.stringify({ 'memory/context.md': UNTRUSTED }))
    const perTurn = formatPerTurnMemoryBlock(
      await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline', sessionId: 's1' }),
    )
    expect(perTurn).toBeNull()
  })

  it('fires a standing intent once per turn (store dedupe)', async () => {
    const h = makeService()
    h.wsFiles.writeContext('billing module notes')
    const added = h.intentStore.add({
      text: 'When touching billing, run the ledger reconciliation tests.',
      trigger: 'billing ledger',
      provenance: OWNER,
    })
    expect(added).not.toBeNull()

    const first = formatPerTurnMemoryBlock(
      await h.svc.buildMemoryBlocks({ query: 'update the billing ledger module', sessionId: 's1' }),
    )
    expect(first).toContain('ledger reconciliation')
    expect(count(first!, INTENT_HEADER)).toBe(1)

    const second = formatPerTurnMemoryBlock(
      await h.svc.buildMemoryBlocks({ query: 'update the billing ledger module', sessionId: 's1' }),
    )
    expect(second ?? '').not.toContain(INTENT_HEADER)
  })
})