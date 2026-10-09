/**
 * DreamRunner — one pass of the background memory "dream" (spec §9).
 *
 * Steps, in order, each one logged as a `MemoryDreamEvent` through `log`:
 *  1. `whenIdle()`   — drain the distillation queue (the ONLY distillation drain);
 *  2. notes          — scan changed vault notes, distil each into *proposals*
 *                      (`proposalsFor(bankId).saveMany`, never a direct lesson
 *                      write), then advance the notes watermark;
 *  3. consolidate    — `runConsolidation(workspaceId)` for workspace banks only;
 *  4. decay          — `runDecayJob()`;
 *  5. commit         — `repo.materialize(bankId, 'dream')` (one commit);
 *  6. summary        — human-readable `DREAMS.md` via `writeDreams` + cost events.
 *
 * Fail-soft: a step that throws is logged as `kind:'error'`, the run ends
 * `status:'error'`, and commits already made are kept. `run()` never rejects —
 * the scheduler depends on that. A run that found nothing to do ends
 * `status:'skipped'` (which is what makes a repeat with no new input free:
 * no distiller call, no commit).
 *
 * The runner owns no storage: `repo`, `cost`, the memory/learning services,
 * the notes scanner, the distiller, the proposal sink and the dreams writer are
 * all injected. Cost of a distiller call is exact when the provider returned a
 * usage block and an estimate (≈4 chars/token) otherwise.
 */
import { randomUUID, createHash } from 'crypto'
import type { MemoryDreamEvent, MemoryDreamRun } from '@rox/shared/memory/repo'
import type { MemoryRepoService } from './MemoryRepoService'
import type { DreamCostTracker, DreamCostUsage } from './DreamCostTracker'
import type { DreamNotesScanner, DreamPendingNote } from './DreamNotesScanner'
import { repoRuleHash } from './repo-import-parser'

/** Minimal memory-service surface the dream needs (MemoryService satisfies it). */
export interface DreamMemoryService {
  whenIdle(): Promise<void>
  runDecayJob(): Promise<void>
}

/** Minimal learning-service surface the dream needs (LearningService satisfies it). */
export interface DreamLearningService {
  runConsolidation(workspaceId: string): Promise<unknown>
}

/** Minimal proposal-store surface (MemoryProposalStore.saveMany satisfies it). */
export interface DreamProposalSink {
  saveMany(items: unknown[]): unknown[] | Promise<unknown[]>
}

export interface DreamDistillerResult {
  text: string
  usage?: DreamCostUsage
}

export type DreamDistiller = (prompt: string, bankId: string) => Promise<DreamDistillerResult>

/**
 * Optional per-run overrides (frozen `memory:dreamRun` contract). `noteIds`
 * forces those notes through the notes step even when unchanged since the
 * watermark; their proposals carry a deterministic identity so repeated
 * forced runs do not mint duplicates.
 */
export interface DreamRunOptions {
  noteIds?: string[]
}

/** Normalize the forced-note list: non-empty strings, de-duplicated, in order. */
function normalizeNoteIds(noteIds?: string[]): string[] {
  if (!Array.isArray(noteIds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of noteIds) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Deterministic dream-proposal identity from `(noteId, ruleHash)`: two runs over
 * the same note with the same distilled rule map to the same proposal row, so a
 * repeated forced run overwrites in place instead of duplicating.
 */
export function dreamProposalId(noteId: string, ruleHash: string): string {
  return `dream-${createHash('sha1').update(`${noteId}\u0000${ruleHash}`).digest('hex').slice(0, 20)}`
}

export interface DreamRunnerConfig {
  dreamModel?: string
  dreamNotes: boolean
}

export interface DreamRunnerDeps {
  repo: MemoryRepoService
  cost: DreamCostTracker
  getMemoryService: (bankId: string) => Promise<DreamMemoryService | null>
  getLearning: (bankId: string) => Promise<DreamLearningService | null>
  notes: DreamNotesScanner
  distiller?: DreamDistiller
  proposalsFor: (bankId: string) => Promise<DreamProposalSink>
  log: (e: MemoryDreamEvent) => Promise<void>
  writeDreams: (bankId: string, md: string) => Promise<void>
  now?: () => Date
  /**
   * Additive (not in the frozen contract, optional): supplies `dreamModel`
   * for event/run labels and gates the notes step on `dreamNotes`. Absent →
   * no model label and notes enabled.
   */
  config?: () => DreamRunnerConfig
  /**
   * Additive (not in the frozen contract, optional): resolves a bank's
   * workspace root so the notes scanner can read that bank's vault and so a
   * bank-aware distiller can be bound. Absent → notes are scanned without a
   * workspace root (a scanner with an explicit `notesDir`/`listNotes` still works).
   */
  resolveWorkspaceRoot?: (bankId: string) => string | undefined
}

export type DreamEventListener = (e: MemoryDreamEvent) => void

/** `ws:<workspaceId>[#ownerKey8]` → workspaceId, otherwise null. */
export function workspaceIdFromBankId(bankId: string): string | null {
  if (!bankId.startsWith('ws:')) return null
  const rest = bankId.slice('ws:'.length)
  const hashAt = rest.indexOf('#')
  const id = hashAt >= 0 ? rest.slice(0, hashAt) : rest
  return id.length > 0 ? id : null
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function countCandidates(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  if (!('candidates' in result)) return 0
  return Array.isArray(result.candidates) ? result.candidates.length : 0
}

/** Rule text of one `{ rule }` / string entry inside a distilled JSON payload. */
function ruleTextFromEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && 'rule' in entry && typeof entry.rule === 'string') return entry.rule
  return ''
}

/** First line of the distilled text (the proposal's rule/fact text). */
function proposalTextFromDistiller(text: string, note: DreamPendingNote): string {
  const trimmed = text.trim()
  if (!trimmed) return note.title?.trim() || note.id
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      const lessons = 'lessons' in parsed ? parsed.lessons : undefined
      const rules = 'rules' in parsed ? parsed.rules : undefined
      const list = Array.isArray(lessons) ? lessons : Array.isArray(rules) ? rules : null
      if (list && list.length > 0) {
        const texts = list.map(ruleTextFromEntry).filter((line) => line.trim().length > 0)
        if (texts.length > 0) return texts.join('\n')
      }
      const body = 'text' in parsed && typeof parsed.text === 'string' ? parsed.text.trim() : ''
      if (body) return body
      const summary = 'summary' in parsed && typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
      if (summary) return summary
    }
  } catch {
    // Not JSON — use the raw distillation text.
  }
  return trimmed
}

function buildNotePrompt(note: DreamPendingNote): string {
  const title = note.title?.trim() ? ` (${note.title.trim()})` : ''
  return [
    'Ты — сон памяти. Прочитай заметку и извлеки только то, что стоит запомнить',
    'как предложение: правила, устойчивые предпочтения и факты. Не выдумывай.',
    '',
    `Заметка${title}:`,
    note.content,
  ].join('\n')
}

interface DreamSummaryInput {
  dreamId: string
  bankId: string
  reason: string
  startedAt: string
  endedAt: string
  status: MemoryDreamRun['status']
  model?: string
  costUsd: number
  estimated: boolean
  notesProcessed: number
  proposalsSaved: number
  candidateCount: number
  committed: boolean
}

function renderDreamsMarkdown(input: DreamSummaryInput): string {
  const cost = input.estimated
    ? `$${input.costUsd.toFixed(6)} (оценка)`
    : `$${input.costUsd.toFixed(6)}`
  const lines = [
    `## Сон ${input.dreamId}`,
    '',
    `- банк: ${input.bankId}`,
    `- причина: ${input.reason}`,
    `- статус: ${input.status}`,
    `- начало: ${input.startedAt}`,
    `- конец: ${input.endedAt}`,
    `- модель: ${input.model ?? '—'}`,
    `- стоимость: ${cost}`,
    `- заметок обработано: ${input.notesProcessed}`,
    `- предложений сохранено: ${input.proposalsSaved}`,
    `- кандидатов консолидации: ${input.candidateCount}`,
    `- коммит: ${input.committed ? 'да' : 'нет'}`,
    '',
  ]
  return lines.join('\n')
}

export class DreamRunner {
  readonly cost: DreamCostTracker
  readonly notes: DreamNotesScanner
  private readonly deps: DreamRunnerDeps
  private readonly now: () => Date
  private readonly listeners = new Set<DreamEventListener>()

  constructor(deps: DreamRunnerDeps) {
    this.deps = deps
    this.cost = deps.cost
    this.notes = deps.notes
    this.now = deps.now ?? (() => new Date())
  }

  /** Subscribe to this runner's events; returns the unsubscribe function. */
  onEvent(listener: DreamEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Pending notes for a bank, with the bank's workspace root applied when a
   * resolver is injected. Also used by the scheduler for `pendingNoteIds`.
   */
  pendingNotes(bankId: string): Promise<DreamPendingNote[]> {
    return this.notes.listPending(this.deps.resolveWorkspaceRoot?.(bankId), workspaceIdFromBankId(bankId))
  }

  private async emit(event: MemoryDreamEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken listener never breaks the dream.
      }
    }
    try {
      await this.deps.log(event)
    } catch {
      // Journaling is best-effort; a failed append must not fail the run.
    }
  }

  private base(bankId: string, dreamId: string, kind: MemoryDreamEvent['kind'], message: string, model?: string): MemoryDreamEvent {
    const event: MemoryDreamEvent = { ts: this.now().toISOString(), dreamId, bankId, kind, message }
    if (model) event.model = model
    return event
  }

  /** Approximate a distiller call's USD when the provider omitted usage. */
  private priceCall(
    model: string | undefined,
    prompt: string,
    result: DreamDistillerResult,
  ): { usd: number; estimated: boolean; inputTokens: number; outputTokens: number } {
    const usage = result.usage
    const hasUsage =
      (typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens)) ||
      (typeof usage?.outputTokens === 'number' && Number.isFinite(usage.outputTokens))
    if (hasUsage) {
      const priced = this.cost.cost(model ?? 'unknown', usage ?? {})
      return {
        usd: priced.usd,
        estimated: priced.estimated,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      }
    }
    const priced = this.cost.costFromText(model ?? 'unknown', prompt, result.text)
    return { usd: priced.usd, estimated: priced.estimated, inputTokens: priced.inputTokens, outputTokens: priced.outputTokens }
  }

  /** One proposal draft per successfully distilled note (never a lesson write). */
  private buildProposal(
    bankId: string,
    dreamId: string,
    note: DreamPendingNote,
    text: string,
    model: string | undefined,
    ts: string,
    tokens: number,
  ): unknown {
    const ruleHash = repoRuleHash(text)
    return {
      id: dreamProposalId(note.id, ruleHash),
      text,
      kind: 'fact',
      status: 'pending',
      sessionId: `dream:${dreamId}`,
      workspaceId: workspaceIdFromBankId(bankId) ?? 'global',
      sourceMessageIds: [],
      provenance: { trigger: 'brain' },
      riskFlags: [],
      conflicts: [],
      editHistory: [],
      createdAt: ts,
      updatedAt: ts,
      cost: { tokens, model: model ?? 'unknown' },
    }
  }

  async run(bankId: string, reason: string, opts?: DreamRunOptions): Promise<MemoryDreamRun> {
    const startedAt = this.now().toISOString()
    const dreamId = randomUUID()
    const config = this.deps.config?.()
    const model = config?.dreamModel
    const notesEnabled = config ? config.dreamNotes : true
    const forcedNoteIds = normalizeNoteIds(opts?.noteIds)
    const workspaceId = workspaceIdFromBankId(bankId)
    const workspaceRoot = this.deps.resolveWorkspaceRoot?.(bankId)

    await this.emit(this.base(bankId, dreamId, 'start', `dream started (${reason})`, model))

    let costUsd = 0
    let costEstimated = false
    let didWork = false
    let committed = false
    let notesProcessed = 0
    let proposalsSaved = 0
    let candidateCount = 0
    const errors: string[] = []
    const fail = async (step: string, error: unknown): Promise<void> => {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${step}: ${message}`)
      await this.emit(this.base(bankId, dreamId, 'error', `${step} failed: ${message}`, model))
    }

    // ── Step 1: drain the distillation queue (the only distillation drain). ──
    let memoryService: DreamMemoryService | null = null
    try {
      memoryService = await this.deps.getMemoryService(bankId)
    } catch (error) {
      await fail('memoryService', error)
    }
    if (memoryService) {
      try {
        await memoryService.whenIdle()
        await this.emit(this.base(bankId, dreamId, 'distill', 'queue drained', model))
      } catch (error) {
        await fail('whenIdle', error)
      }
    } else {
      await this.emit(this.base(bankId, dreamId, 'distill', 'no memory service for bank', model))
    }

    // ── Step 2: changed notes → proposals → watermark. ──
    if (!notesEnabled) {
      await this.emit(this.base(bankId, dreamId, 'notes', 'notes step disabled', model))
    } else if (!this.deps.distiller) {
      await this.emit(this.base(bankId, dreamId, 'notes', 'no distiller configured', model))
    } else {
      const distiller = this.deps.distiller
      try {
        const pending = await this.pendingNotes(bankId)
        // Forced ids bypass the changed-since-watermark filter: `listByIds`
        // returns their current content even when unchanged.
        const forced = forcedNoteIds.length > 0 ? await this.notes.listByIds(forcedNoteIds, workspaceRoot, workspaceId) : []
        const byId = new Map<string, DreamPendingNote>()
        for (const note of pending) byId.set(note.id, note)
        for (const note of forced) byId.set(note.id, note)
        const notes = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        if (notes.length === 0) {
          await this.emit(this.base(bankId, dreamId, 'notes', 'no changed notes', model))
        } else {
          const processedIds: string[] = []
          const drafts: unknown[] = []
          for (const note of notes) {
            const prompt = buildNotePrompt(note)
            const result = await distiller(prompt, bankId)
            const priced = this.priceCall(model, prompt, result)
            costUsd += priced.usd
            if (priced.estimated) costEstimated = true
            const ts = this.now().toISOString()
            this.cost.record(bankId, priced.usd, ts, priced.estimated)
            await this.emit({
              ...this.base(bankId, dreamId, 'cost', `note ${note.id}: $${priced.usd.toFixed(6)}${priced.estimated ? ' (estimate)' : ''}`, model),
              inputTokens: priced.inputTokens,
              outputTokens: priced.outputTokens,
              costUsd: priced.usd,
            })
            const text = proposalTextFromDistiller(result.text, note)
            drafts.push(this.buildProposal(bankId, dreamId, note, text, model, ts, priced.inputTokens + priced.outputTokens))
            processedIds.push(note.id)
          }
          const sink = await this.deps.proposalsFor(bankId)
          const saved = await sink.saveMany(drafts)
          proposalsSaved = Array.isArray(saved) ? saved.length : drafts.length
          await this.notes.markProcessed(processedIds, workspaceRoot, workspaceId)
          notesProcessed = processedIds.length
          didWork = true
          await this.emit(
            this.base(bankId, dreamId, 'notes', `processed ${notesProcessed} note(s), ${proposalsSaved} proposal(s)`, model),
          )
        }
      } catch (error) {
        await fail('notes', error)
      }
    }

    // ── Step 3: consolidation (workspace banks only). ──
    if (!workspaceId) {
      await this.emit(this.base(bankId, dreamId, 'consolidate', 'global bank — consolidation skipped', model))
    } else {
      try {
        const learning = await this.deps.getLearning(bankId)
        if (!learning) {
          await this.emit(this.base(bankId, dreamId, 'consolidate', 'no learning service for bank', model))
        } else {
          const result = await learning.runConsolidation(workspaceId)
          candidateCount = countCandidates(result)
          if (candidateCount > 0) didWork = true
          await this.emit(this.base(bankId, dreamId, 'consolidate', `${candidateCount} candidate(s)`, model))
        }
      } catch (error) {
        await fail('consolidation', error)
      }
    }

    // ── Step 4: decay. ──
    if (memoryService) {
      try {
        await memoryService.runDecayJob()
        await this.emit(this.base(bankId, dreamId, 'decay', 'decay job done', model))
      } catch (error) {
        await fail('decay', error)
      }
    } else {
      await this.emit(this.base(bankId, dreamId, 'decay', 'no memory service for bank', model))
    }

    // ── Step 5: materialize + one commit. ──
    try {
      const materialized = await this.deps.repo.materialize(bankId, 'dream')
      committed = materialized.committed === true
      if (committed) didWork = true
      if (materialized.error) {
        // A batch that failed to land is NOT a no-op: journal it as an error so
        // the run does not end `ok`/`skipped` on top of a failed commit.
        await fail('commit', materialized.error)
      } else {
        await this.emit(
          this.base(bankId, dreamId, 'commit', committed ? `committed ${materialized.files} file(s)` : 'nothing to commit', model),
        )
      }
    } catch (error) {
      await fail('commit', error)
    }

    // ── Step 6: human-readable summary. ──
    const endedAt = this.now().toISOString()
    const status: MemoryDreamRun['status'] = errors.length > 0 ? 'error' : didWork ? 'ok' : 'skipped'
    const summary = renderDreamsMarkdown({
      dreamId,
      bankId,
      reason,
      startedAt,
      endedAt,
      status,
      model,
      costUsd: round6(costUsd),
      estimated: costEstimated,
      notesProcessed,
      proposalsSaved,
      candidateCount,
      committed,
    })
    try {
      await this.deps.writeDreams(bankId, summary)
    } catch (error) {
      await fail('writeDreams', error)
    }

    const finalStatus: MemoryDreamRun['status'] = errors.length > 0 ? 'error' : didWork ? 'ok' : 'skipped'
    const run: MemoryDreamRun = {
      dreamId,
      bankId,
      startedAt,
      endedAt,
      status: finalStatus,
      costUsd: round6(costUsd),
      costIsEstimate: costEstimated,
    }
    if (model) run.model = model
    if (errors.length > 0) run.error = errors.join('; ')

    await this.emit(this.base(bankId, dreamId, 'end', `dream ${finalStatus}`, model))
    return run
  }
}