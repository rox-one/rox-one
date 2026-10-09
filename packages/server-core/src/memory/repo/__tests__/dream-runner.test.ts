/**
 * DreamRunner — step order, notes→proposals (never direct lesson writes),
 * watermark advance, fail-soft behaviour and the skipped repeat.
 * Acceptance: repeat with no new input ⇒ 0 distiller calls, status 'skipped';
 * a pending note ⇒ exactly one proposal + watermark; a distiller failure marks
 * the run `error` without throwing.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MemoryDreamEvent, MemoryDreamRun } from '@rox/shared/memory/repo'
import type { MemoryRepoService } from '../MemoryRepoService'
import { DreamCostTracker } from '../DreamCostTracker'
import { DreamNotesScanner } from '../DreamNotesScanner'
import type { DreamNote } from '../DreamNotesScanner'
import { DreamRunner, dreamProposalId } from '../DreamRunner'
import type { DreamDistiller } from '../DreamRunner'
import { repoRuleHash } from '../repo-import-parser'

const roots: string[] = []
function mkroot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dream-runner-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface HarnessOptions {
  notes?: DreamNote[]
  distiller?: DreamDistiller
  committed?: boolean
  materializeError?: string
  now?: () => Date
}

function buildHarness(options: HarnessOptions = {}) {
  const root = mkroot()
  const stateFile = join(root, 'memory', 'notes-watermark.json')
  const notes = options.notes ?? []
  const scanner = new DreamNotesScanner({ stateFile, listNotes: async () => notes })
  const stats = { whenIdle: 0, decay: 0, distiller: 0 }
  const savedBatches: unknown[][] = []
  const logs: MemoryDreamEvent[] = []
  const dreams: string[] = []
  const consolidationCalls: string[] = []

  const repo = {
    materialize: async () => ({
      committed: options.committed === true,
      files: options.committed ? 2 : 0,
      edited: [],
      ...(options.materializeError ? { error: options.materializeError } : {}),
    }),
    dreamBankIds: async () => ['main'],
  } as unknown as MemoryRepoService

  const distiller = options.distiller
  const runner = new DreamRunner({
    repo,
    cost: new DreamCostTracker({ 'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.6 } }),
    getMemoryService: async () => ({
      whenIdle: async () => {
        stats.whenIdle += 1
      },
      runDecayJob: async () => {
        stats.decay += 1
      },
    }),
    getLearning: async () => ({
      runConsolidation: async (workspaceId: string) => {
        consolidationCalls.push(workspaceId)
        return { candidates: [] }
      },
    }),
    notes: scanner,
    ...(distiller
      ? {
          distiller: async (prompt: string, bankId: string) => {
            stats.distiller += 1
            return distiller(prompt, bankId)
          },
        }
      : {}),
    proposalsFor: async () => ({
      saveMany: async (items: unknown[]) => {
        savedBatches.push(items)
        return items
      },
    }),
    log: async (event) => {
      logs.push(event)
    },
    writeDreams: async (_bankId, md) => {
      dreams.push(md)
    },
    now: options.now ?? (() => new Date('2026-10-09T12:00:00Z')),
    config: () => ({ dreamModel: 'gpt-4o-mini', dreamNotes: true }),
  })

  return { runner, stateFile, notes, stats, savedBatches, logs, dreams, consolidationCalls }
}

const NOTE: DreamNote = { id: 'a.md', title: 'Идея', updatedAt: '2026-10-09T00:00:00Z', content: 'Всегда запускать тесты' }

/** Narrow a saved proposal draft to its string id (no unchecked member access). */
function proposalIdOf(batch: unknown[]): string {
  const item = batch[0]
  if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') return item.id
  throw new Error('expected a proposal draft with a string id')
}

describe('DreamRunner', () => {
  it('skips a repeat run with no new input and calls no distiller', async () => {
    const h = buildHarness({ notes: [], distiller: async () => ({ text: 'x' }) })

    const first = await h.runner.run('main', 'interval')
    const second = await h.runner.run('main', 'interval')

    expect(first.status).toBe('skipped')
    expect(second.status).toBe('skipped')
    expect(h.stats.distiller).toBe(0)
    expect(h.savedBatches).toHaveLength(0)
  })

  it('calls whenIdle exactly once per run and always decays', async () => {
    const h = buildHarness({ notes: [] })
    await h.runner.run('main', 'manual')
    expect(h.stats.whenIdle).toBe(1)
    expect(h.stats.decay).toBe(1)
  })

  it('turns one pending note into exactly one proposal, advances the watermark, then stays quiet', async () => {
    const h = buildHarness({
      notes: [NOTE],
      distiller: async () => ({ text: 'Always run tests', usage: { inputTokens: 100, outputTokens: 20 } }),
    })

    const first = await h.runner.run('main', 'manual')
    expect(first.status).toBe('ok')
    expect(h.stats.distiller).toBe(1)
    expect(h.savedBatches).toHaveLength(1)
    expect(h.savedBatches[0]).toHaveLength(1)
    expect(h.dreams).toHaveLength(1)

    expect(existsSync(h.stateFile)).toBe(true)
    const watermark = JSON.parse(readFileSync(h.stateFile, 'utf-8')) as Record<string, string>
    expect(Object.keys(watermark)).toEqual(['a.md'])

    const second = await h.runner.run('main', 'manual')
    expect(second.status).toBe('skipped')
    expect(h.stats.distiller).toBe(1)
    expect(h.savedBatches).toHaveLength(1)
  })

  it('records exact cost from the distiller usage block', async () => {
    const h = buildHarness({
      notes: [NOTE],
      distiller: async () => ({ text: 'rule', usage: { inputTokens: 1000, outputTokens: 2000 } }),
    })
    const run = await h.runner.run('main', 'manual')
    expect(run.costIsEstimate).toBe(false)
    expect(run.costUsd).toBeCloseTo((1000 / 1e6) * 0.15 + (2000 / 1e6) * 0.6, 6)
    expect(h.runner.cost.todayTotal('main', new Date('2026-10-09T12:00:00Z'))).toBeCloseTo(run.costUsd, 6)
  })

  it('marks the run error when the distiller fails, without throwing or advancing the watermark', async () => {
    const h = buildHarness({
      notes: [NOTE],
      distiller: async () => {
        throw new Error('boom')
      },
    })

    const run: MemoryDreamRun = await h.runner.run('main', 'interval')
    expect(run.status).toBe('error')
    expect(run.error).toContain('boom')
    expect(h.savedBatches).toHaveLength(0)
    expect(existsSync(h.stateFile)).toBe(false)
    expect(h.logs.some((e) => e.kind === 'error')).toBe(true)
    // The note is still pending for the next dream.
    expect((await h.runner.notes.listPending()).map((n) => n.id)).toEqual(['a.md'])
  })

  it('runs consolidation with the workspace id for workspace banks only', async () => {
    const h = buildHarness({ notes: [] })
    await h.runner.run('ws:proj', 'manual')
    expect(h.consolidationCalls).toEqual(['proj'])

    await h.runner.run('main', 'manual')
    expect(h.consolidationCalls).toEqual(['proj'])
  })

  it('reports ok when a commit happened even without notes', async () => {
    const h = buildHarness({ notes: [], committed: true })
    const run = await h.runner.run('main', 'interval')
    expect(run.status).toBe('ok')
  })

  it('passes the bank to the distiller and resolves the bank workspace root for note scanning', async () => {
    const root = mkroot()
    const vault = join(root, 'vault')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'idea.md'), '# Идея\n\nВсегда запускать тесты\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: '$WORKSPACE/vault' } }),
    )

    const stateFile = join(root, 'memory', 'notes-watermark.json')
    const savedBatches: unknown[][] = []
    const seenBankIds: string[] = []
    const scanner = new DreamNotesScanner({ stateFile })
    const repo = {
      materialize: async () => ({ committed: false, files: 0, edited: [] }),
      dreamBankIds: async () => ['ws:proj'],
    } as unknown as MemoryRepoService

    const runner = new DreamRunner({
      repo,
      cost: new DreamCostTracker(),
      getMemoryService: async () => null,
      getLearning: async () => null,
      notes: scanner,
      distiller: async (_prompt, bankId) => {
        seenBankIds.push(bankId)
        return { text: 'Always run tests' }
      },
      proposalsFor: async () => ({
        saveMany: async (items: unknown[]) => {
          savedBatches.push(items)
          return items
        },
      }),
      log: async () => {},
      writeDreams: async () => {},
      now: () => new Date('2026-10-09T12:00:00Z'),
      resolveWorkspaceRoot: (bankId) => (bankId.startsWith('ws:') ? root : undefined),
    })

    const run = await runner.run('ws:proj', 'manual')
    expect(run.status).toBe('ok')
    expect(seenBankIds).toEqual(['ws:proj'])
    expect(savedBatches).toHaveLength(1)
    expect(savedBatches[0]).toHaveLength(1)
  })

  it('S6: a forced note is distilled even when unchanged; a repeat forced run mints no new proposal', async () => {
    const h = buildHarness({
      notes: [NOTE],
      distiller: async () => ({ text: 'Always run tests' }),
    })

    // (1) The first forced run distils an otherwise-unchanged note and advances the watermark.
    const first = await h.runner.run('main', 'manual', { noteIds: ['a.md'] })
    expect(first.status).toBe('ok')
    expect(h.stats.distiller).toBe(1)
    expect(h.savedBatches).toHaveLength(1)

    // A plain run now sees no change (watermark absorbed) — the forced path is what re-runs it.
    const plain = await h.runner.run('main', 'manual')
    expect(plain.status).toBe('skipped')
    expect(h.stats.distiller).toBe(1)

    // (2) A second forced run distils again but its proposal identity is deterministic
    // from (noteId, ruleHash): no NEW proposal row, the same id is overwritten in place.
    const second = await h.runner.run('main', 'manual', { noteIds: ['a.md'] })
    expect(second.status).toBe('ok')
    expect(h.stats.distiller).toBe(2)
    expect(h.savedBatches).toHaveLength(2)
    const firstId = proposalIdOf(h.savedBatches[0]!)
    const secondId = proposalIdOf(h.savedBatches[1]!)
    expect(secondId).toBe(firstId)
    expect(secondId).toBe(dreamProposalId('a.md', repoRuleHash('Always run tests')))
  })

  it('emits the documented step kinds in order', async () => {
    const h = buildHarness({
      notes: [NOTE],
      distiller: async () => ({ text: 'rule', usage: { inputTokens: 1, outputTokens: 1 } }),
    })
    await h.runner.run('main', 'manual')
    const kinds = h.logs.map((e) => e.kind)
    expect(kinds[0]).toBe('start')
    expect(kinds).toContain('distill')
    expect(kinds).toContain('notes')
    expect(kinds).toContain('cost')
    expect(kinds).toContain('decay')
    expect(kinds).toContain('commit')
    expect(kinds[kinds.length - 1]).toBe('end')
    expect(kinds.indexOf('distill')).toBeLessThan(kinds.indexOf('notes'))
    expect(kinds.indexOf('notes')).toBeLessThan(kinds.indexOf('commit'))
  })

  it('F3: an unchanged batch reports nothing to commit with no error', async () => {
    const h = buildHarness({ notes: [] })
    const run = await h.runner.run('main', 'interval')
    expect(run.status).toBe('skipped')
    expect(run.error).toBeUndefined()
    expect(h.logs.some((e) => e.kind === 'error')).toBe(false)
    expect(h.logs.some((e) => e.kind === 'commit' && e.message === 'nothing to commit')).toBe(true)
  })

  it('F3: a failed materialize is journaled as an error, not "nothing to commit"', async () => {
    const h = buildHarness({ notes: [], materializeError: 'injected commit failure' })
    const run: MemoryDreamRun = await h.runner.run('main', 'interval')
    expect(run.status).toBe('error')
    expect(run.error).toContain('injected commit failure')
    expect(h.logs.some((e) => e.kind === 'error' && e.message.includes('injected commit failure'))).toBe(true)
    expect(h.logs.some((e) => e.kind === 'commit')).toBe(false)
    expect(h.dreams).toHaveLength(1)
  })
})