/**
 * WP-110 — MemoryService ⇄ learning layer seam (PRD §7/§31/§45 Wave 3–4).
 *
 * Covers the four contract rules of the seam:
 *   - no `learningService` → byte-for-byte legacy behavior;
 *   - `handled:true` → the learning layer owns the item, legacy write skipped;
 *   - `handled:false` (learning disabled/out of scope) → legacy write kept;
 *   - `ingestDistilled` throws → logged and the legacy write still happens.
 * Plus `recordContextUsage` reporting from `buildMemoryBlocks`.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import { MemoryService } from '../MemoryService'
import { LessonStore } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { EpisodicMemory } from '../episodic-memory'
import { closeAll } from '../fts-index'
import type { LearningServicePorts } from '../learning/learning-types'
import type { DistillResult, Lesson, MemoryConfig, SkillCandidate } from '@rox/shared/memory/types'
import type { StoredMessage } from '@rox/core/types'

type IngestInput = Parameters<LearningServicePorts['ingestDistilled']>[0]
type UsageInput = Parameters<LearningServicePorts['recordContextUsage']>[0]

const MSGS: StoredMessage[] = [
  { id: 'm1', type: 'user', content: 'ship it' },
  { id: 'm2', type: 'assistant', content: 'done' },
]

const DISTILLED: DistillResult = {
  history_entry: null,
  memory_update: null,
  lessons: [{ rule: 'Run tsc after edits', category: 'workflow' }],
  skill_candidate: { slug: 'sweep-thing', description: 'sweep', body: '# sweep it' },
}

interface LearningStub {
  stub: LearningServicePorts
  ingestCalls: IngestInput[]
  usageCalls: UsageInput[]
}

/** Minimal LearningServicePorts test double — only the two WP-110 methods matter. */
function learningStub(handlers: {
  ingest?: (input: IngestInput) => { handled: boolean; promoted: boolean }
  usage?: (input: UsageInput) => void
} = {}): LearningStub {
  const ingestCalls: IngestInput[] = []
  const usageCalls: UsageInput[] = []
  const stub = {
    ingestDistilled: async (input: IngestInput) => {
      ingestCalls.push(input)
      return handlers.ingest ? handlers.ingest(input) : { handled: true, promoted: false }
    },
    recordContextUsage: (input: UsageInput) => {
      usageCalls.push(input)
      if (handlers.usage) handlers.usage(input)
    },
  } as unknown as LearningServicePorts
  return { stub, ingestCalls, usageCalls }
}

function makeService(opts: {
  result?: DistillResult
  learningService?: LearningServicePorts
  autoCreate?: boolean
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'memsvc-learn-'))
  const enqueued: SkillCandidate[] = []
  const emitted: Array<[string, unknown[]]> = []
  const config: MemoryConfig = {
    enabled: true, distillIdleHours: 3, distillMsgCount: 30, negativeFirst: true,
    redactExtraPatterns: [], ftsLimit: 20, semantic: false,
  }
  const wsFiles = new MemoryFileStore('workspace', root)
  const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
  const globalLessons = new LessonStore(
    new MemoryFileStore('global', root, join(root, 'global-config')).lessonsPath,
    'global',
  )
  let fire: ((evt: { sessionId: string; reason: 'complete' | 'interrupted' }) => void) | null = null
  const svc = new MemoryService({
    workspaceRoot: root,
    workspaceId: 'ws-1',
    lessonStoreFactory: (scope) => (scope === 'global' ? globalLessons : wsLessons),
    fileStore: wsFiles,
    skillQueue: { enqueue: (c: SkillCandidate) => (enqueued.push(c), true) } as never,
    episodicMemory: new EpisodicMemory(wsFiles.memoryDir, { embedder: async (texts) => texts.map(() => [0]) }),
    distiller: async () => JSON.stringify(opts.result ?? DISTILLED),
    emit: (channel, args) => emitted.push([channel, args]),
    logger: { warn: () => {} },
    readMessages: () => MSGS,
    getConfig: () => config,
    isSkillAutoCreateEnabled: () => opts.autoCreate ?? true,
    learningService: opts.learningService,
    readSessionProvenance: () => [],
  })
  svc.attachSessionCompletion((cb) => {
    fire = cb as typeof fire
    return () => {}
  })
  return {
    svc,
    wsFiles,
    wsLessons,
    globalLessons,
    enqueued,
    emitted,
    root,
    complete: (sessionId = 's1') => fire!({ sessionId, reason: 'complete' }),
  }
}

/** Flush the async FIFO drain deterministically (no wall-clock timers). */
async function drain(svc: MemoryService): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await svc.whenIdle()
}

function seedLessons(h: { globalLessons: LessonStore; wsLessons: LessonStore }): void {
  h.globalLessons.add({
    ts: '2026-01-01T00:00:00Z', rule: 'global rule', category: 'preference',
    scope: 'global', source: { trigger: 'explicit' },
  } as Lesson)
  h.wsLessons.add({
    ts: '2026-01-01T00:00:01Z', rule: 'ws rule', category: 'workflow',
    scope: 'workspace', source: { trigger: 'explicit' },
  } as Lesson)
}

const tmpRoots: string[] = []

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true })
  closeAll()
})

describe('MemoryService learning seam — lessons', () => {
  it('no learningService → legacy lesson + skill writes unchanged', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.wsLessons.list().map(l => l.rule)).toEqual(['Run tsc after edits'])
    expect(h.enqueued.map(c => c.slug)).toEqual(['sweep-thing'])
    expect(h.emitted.some(([ch]) => ch === 'memory:changed')).toBe(true)
  })

  it('handled:true → legacy lesson write suppressed, DTO forwarded', async () => {
    const learning = learningStub()
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.wsLessons.list()).toHaveLength(0)
    expect(learning.ingestCalls.filter(c => c.kind === 'lesson')).toEqual([{
      workspaceId: 'ws-1',
      sessionId: 's1',
      kind: 'lesson',
      rule: 'Run tsc after edits',
      category: 'workflow',
      negative: undefined,
    }])
  })

  it('handled:false (learning disabled at policy level) → legacy write happens', async () => {
    const learning = learningStub({ ingest: () => ({ handled: false, promoted: false }) })
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(learning.ingestCalls.filter(c => c.kind === 'lesson')).toHaveLength(1)
    expect(h.wsLessons.list().map(l => l.rule)).toEqual(['Run tsc after edits'])
  })

  it('ingestDistilled throws → logged, legacy write still lands (no data loss)', async () => {
    const learning = learningStub({ ingest: () => { throw new Error('learning boom') } })
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.wsLessons.list().map(l => l.rule)).toEqual(['Run tsc after edits'])
  })
})

describe('MemoryService learning seam — skills', () => {
  it('handled:true → legacy SkillPendingQueue enqueue suppressed', async () => {
    const learning = learningStub()
    const h = makeService({ learningService: learning.stub, autoCreate: true })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.enqueued).toHaveLength(0)
    expect(learning.ingestCalls.filter(c => c.kind === 'skill')).toEqual([{
      workspaceId: 'ws-1',
      sessionId: 's1',
      kind: 'skill',
      skill: { slug: 'sweep-thing', description: 'sweep', body: '# sweep it' },
    }])
  })

  it('handled:false + legacy gate on → legacy enqueue happens', async () => {
    const learning = learningStub({ ingest: () => ({ handled: false, promoted: false }) })
    const h = makeService({ learningService: learning.stub, autoCreate: true })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(learning.ingestCalls.filter(c => c.kind === 'skill')).toHaveLength(1)
    expect(h.enqueued.map(c => c.slug)).toEqual(['sweep-thing'])
  })

  it('skill ingest throws → legacy enqueue fallback', async () => {
    const learning = learningStub({ ingest: () => { throw new Error('learning boom') } })
    const h = makeService({ learningService: learning.stub, autoCreate: true })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.enqueued.map(c => c.slug)).toEqual(['sweep-thing'])
  })

  it('sensitive candidate never reaches the learning layer', async () => {
    const learning = learningStub()
    const h = makeService({
      learningService: learning.stub,
      result: { ...DISTILLED, skill_candidate: { slug: 'read-ssh', description: 'x', body: 'reads ~/.ssh' } },
    })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(learning.ingestCalls.filter(c => c.kind === 'skill')).toHaveLength(0)
    expect(h.enqueued).toHaveLength(0)
  })
})

describe('MemoryService learning seam — recordContextUsage', () => {
  it('reports the assembled lessons (and no skills) with the session id', async () => {
    const learning = learningStub()
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    seedLessons(h)
    const blocks = await h.svc.buildMemoryBlocks({ sessionId: 's1' })
    expect(blocks?.used).toEqual([
      { rule: 'global rule', scope: 'global' },
      { rule: 'ws rule', scope: 'workspace' },
    ])
    expect(learning.usageCalls).toEqual([{
      workspaceId: 'ws-1',
      sessionId: 's1',
      lessons: [
        { rule: 'global rule', scope: 'global' },
        { rule: 'ws rule', scope: 'workspace' },
      ],
      skills: [],
    }])
  })

  it('no session id → recordContextUsage is never called', async () => {
    const learning = learningStub()
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    seedLessons(h)
    await h.svc.buildMemoryBlocks()
    expect(learning.usageCalls).toHaveLength(0)
  })

  it('a throwing recordContextUsage never breaks prompt assembly', async () => {
    const learning = learningStub({ usage: () => { throw new Error('usage boom') } })
    const h = makeService({ learningService: learning.stub })
    tmpRoots.push(h.root)
    seedLessons(h)
    const blocks = await h.svc.buildMemoryBlocks({ sessionId: 's1' })
    expect(blocks?.lessonsBlock).toContain('global rule')
    expect(learning.usageCalls).toHaveLength(1)
  })
})