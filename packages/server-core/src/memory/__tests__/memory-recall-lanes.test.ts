/**
 * c1.5 recall lanes + c1.6 standing intents — MemoryService wiring.
 *
 * Exercises the real prompt-assembly entry point (buildMemoryBlocks), the same
 * one SessionManager calls at backend spawn: lane one is deterministic and
 * lexical-only; lane two escalates only when lane one is inconclusive and
 * never over untrusted chunks; standing intents fire once per turn.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  RECALL_ESCALATION_MAX_CANDIDATES,
  RECALL_ESCALATION_MAX_PROMPT_CHARS,
} from '@rox/shared/memory/context-select'
import type { MemoryConfig, MemoryChunkProvenance } from '@rox/shared/memory/types'
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

const UNTRUSTED: MemoryChunkProvenance = { originClass: 'untrusted', sessionKind: 'unknown', observedAt: '2026-01-01T00:00:00.000Z' }
const OWNER: MemoryChunkProvenance = { originClass: 'owner', sessionKind: 'interactive', observedAt: '2026-01-01T00:00:00.000Z' }

function makeService(opts: { recallAgent?: (prompt: string) => Promise<string>; recallMode?: 'off' | 'auto' | 'always' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'memrecall-'))
  roots.push(root)
  const wsFiles = new MemoryFileStore('workspace', root)
  const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
  const globalLessons = new LessonStore(new MemoryFileStore('global', root, join(root, 'global-config')).lessonsPath, 'global')
  const intentStore = new StandingIntentStore(wsFiles.intentsPath)
  const config: MemoryConfig = {
    enabled: true,
    distillIdleHours: 3,
    distillMsgCount: 30,
    dreamIntervalHours: 4,
    dreamNotes: true,
    negativeFirst: true,
    redactExtraPatterns: [],
    ftsLimit: 20,
    semantic: false,
  }
  const svc = new MemoryService({
    workspaceRoot: root,
    workspaceId: 'ws-1',
    lessonStoreFactory: (scope) => (scope === 'global' ? globalLessons : wsLessons),
    fileStore: wsFiles,
    standingIntentStore: intentStore,
    ...(opts.recallAgent ? { recallAgent: opts.recallAgent } : {}),
    ...(opts.recallMode ? { recallMode: opts.recallMode } : {}),
    getConfig: () => config,
    logger: { warn: () => {} },
  })
  return { svc, root, wsFiles, intentStore }
}

const pickFirstId = (prompt: string): string => {
  const match = prompt.match(/id=(\w+)/)
  if (!match || !match[1]) throw new Error('test agent got no candidate ids')
  return match[1]
}

describe('c1.5 recall lane one (deterministic lexical trigger)', () => {
  it('recalls a strong lexical match, deterministically', async () => {
    const h = makeService()
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline every time.')
    const first = await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline' })
    expect(first?.recall?.lane).toBe(1)
    expect(first?.recallBlock).toContain('vercel pipeline')
    expect(first?.recall?.refs[0]?.path).toBe('memory/context.md')
    const second = await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline' })
    expect(second?.recallBlock).toBe(first?.recallBlock)
    expect(second?.recall).toEqual(first?.recall)
  })

  it('does not recall below the 0.65 threshold', async () => {
    const h = makeService()
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline.')
    const blocks = await h.svc.buildMemoryBlocks({ query: 'deploy unrelated zebra' })
    expect(blocks?.recall).toBeUndefined()
    expect(blocks?.recallBlock).toBeUndefined()
  })
})

describe('c1.5 recall lane two (escalation sub-agent)', () => {
  it('escalates only when lane one is inconclusive and the message shows recall intent', async () => {
    let calls = 0
    const h = makeService({ recallAgent: async (prompt) => (calls += 1, JSON.stringify({ ids: [pickFirstId(prompt)] })) })
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline.')
    const escalated = await h.svc.buildMemoryBlocks({ query: 'what did we decide about the vercel pipeline' })
    expect(escalated?.recall?.lane).toBe(2)
    expect(calls).toBe(1)

    // A strong lane-one hit must never escalate.
    calls = 0
    const strong = await h.svc.buildMemoryBlocks({ query: 'deploy previews vercel pipeline' })
    expect(strong?.recall?.lane).toBe(1)
    expect(calls).toBe(0)
  })

  it('never escalates untrusted chunks into the prompt', async () => {
    let calls = 0
    const h = makeService({ recallAgent: async () => (calls += 1, '{"ids":[]}') })
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline.')
    writeFileSync(join(h.root, 'memory', 'index-provenance.json'), JSON.stringify({ 'memory/context.md': UNTRUSTED }))
    const blocks = await h.svc.buildMemoryBlocks({ query: 'what did we decide about the vercel pipeline' })
    expect(blocks?.recall).toBeUndefined()
    expect(blocks?.recallBlock).toBeUndefined()
    expect(calls).toBe(0)
  })

  it('bounds the escalation prompt and the offered candidate count', async () => {
    let prompt = ''
    const h = makeService({ recallAgent: async (p) => (prompt = p, '{"ids":[]}') })
    for (let day = 1; day <= 12; day += 1) {
      h.wsFiles.appendDailyHistory(`vercel pipeline note ${day}`, `2026-01-${String(day).padStart(2, '0')}`)
    }
    await h.svc.buildMemoryBlocks({ query: 'what did we decide about vercel pipeline and alpha beta gamma' })
    expect(prompt.length).toBeLessThanOrEqual(RECALL_ESCALATION_MAX_PROMPT_CHARS)
    expect((prompt.match(/id=/g) ?? []).length).toBeLessThanOrEqual(RECALL_ESCALATION_MAX_CANDIDATES)
  })

  it('respects recallMode off', async () => {
    let calls = 0
    const h = makeService({ recallMode: 'off', recallAgent: async () => (calls += 1, '{"ids":[]}') })
    h.wsFiles.writeContext('Deploy previews run through the vercel pipeline.')
    const blocks = await h.svc.buildMemoryBlocks({ query: 'what did we decide about the vercel pipeline' })
    expect(blocks?.recall).toBeUndefined()
    expect(calls).toBe(0)
  })
})

describe('c1.6 standing intents', () => {
  it('injects a matched intent once and marks it fired', async () => {
    const h = makeService()
    h.wsFiles.writeContext('billing module notes')
    const added = h.intentStore.add({
      text: 'When touching billing, run the ledger reconciliation tests.',
      trigger: 'billing ledger',
      provenance: OWNER,
    })
    expect(added).not.toBeNull()
    const first = await h.svc.buildMemoryBlocks({ query: 'update the billing ledger module' })
    expect(first?.intentBlock).toContain('ledger reconciliation')
    expect(first?.intents).toEqual([added!.id])

    const second = await h.svc.buildMemoryBlocks({ query: 'update the billing ledger module' })
    expect(second?.intentBlock).toBeUndefined()
  })

  it('rejects a time-only reminder (cron owns scheduling)', () => {
    const h = makeService()
    const added = h.intentStore.add({
      text: 'remind me tomorrow at 9',
      trigger: 'tomorrow',
      provenance: OWNER,
    })
    expect(added).toBeNull()
    expect(h.intentStore.list()).toEqual([])
  })
})