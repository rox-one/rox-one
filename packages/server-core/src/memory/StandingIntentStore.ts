/**
 * StandingIntentStore — prospective memory (spec c1.6).
 *
 * One `standing-intents.jsonl` per workspace (`{workspace}/memory/`) holding
 * event-conditioned intents the agent recalls when a later prompt matches each
 * intent's trigger keywords. Adapted from OpenClaw
 * `extensions/memory-core/src/standing-intents-kernel.ts` (port-matrix row
 * c1.6): the same armed/fired/done lifecycle with a cooldown rearm.
 *
 * Invariants:
 * - A time-only reminder ("remind me tomorrow at 9") is NOT a standing intent
 *   — scheduling belongs to cron. `add` rejects it (returns null) and the
 *   matcher ignores it, so it can never be injected here.
 * - Provenance is stamped at creation from the producing session kind and is
 *   the injection gate: only owner/agent intents ever reach a prompt.
 * - Matching is deduplicated and bounded (see matchStandingIntents in
 *   @rox/shared/memory/context-select); firing bumps fireCount and flips the
 *   status so an intent is injected once per turn, not repeatedly.
 * - Corrupt lines are skipped, never thrown.
 */
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { isTimeOnlyIntent } from '@rox/shared/memory/context-select'
import type { MemoryChunkProvenance, StandingIntent, StandingIntentStatus } from '@rox/shared/memory/types'

/** Default: an intent fires once, then is done. */
const DEFAULT_MAX_FIRES = 1
/** Default cooldown before a fired intent with remaining fires re-arms. */
const DEFAULT_COOLDOWN_SECONDS = 0

export interface StandingIntentAddInput {
  /** The intent text injected into the prompt when it fires. */
  text: string
  /** Keyword phrase whose tokens gate firing (all tokens must be present). */
  trigger: string
  /** Write-time provenance (origin class + producing session kind). */
  provenance: MemoryChunkProvenance
  maxFires?: number
  cooldownSeconds?: number
  /** ISO timestamp; defaults to now. */
  ts?: string
}

/** Persisted row: the public intent plus its lifecycle bookkeeping. */
interface StandingIntentRow {
  id: string
  text: string
  trigger: string
  createdAt: string
  status: StandingIntentStatus
  fireCount: number
  maxFires: number
  cooldownSeconds: number
  lastFiredAt?: string
  provenance: MemoryChunkProvenance
}

function parseRows(content: string): StandingIntentRow[] {
  const rows: StandingIntentRow[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as StandingIntentRow
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.text === 'string' && typeof parsed.trigger === 'string') {
        rows.push({
          ...parsed,
          status: parsed.status ?? 'armed',
          fireCount: typeof parsed.fireCount === 'number' ? parsed.fireCount : 0,
          maxFires: typeof parsed.maxFires === 'number' && parsed.maxFires > 0 ? parsed.maxFires : DEFAULT_MAX_FIRES,
          cooldownSeconds: typeof parsed.cooldownSeconds === 'number' ? parsed.cooldownSeconds : DEFAULT_COOLDOWN_SECONDS,
        })
      }
    } catch {
      // skip corrupt line
    }
  }
  return rows
}

export class StandingIntentStore {
  readonly filePath: string
  private readonly clock: () => number

  constructor(filePath: string, deps?: { clock?: () => number }) {
    this.filePath = filePath
    this.clock = deps?.clock ?? (() => Date.now())
  }

  private read(): StandingIntentRow[] {
    if (!existsSync(this.filePath)) return []
    try {
      return parseRows(readFileSync(this.filePath, 'utf8'))
    } catch {
      return []
    }
  }

  private write(rows: StandingIntentRow[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const body = rows.map((row) => JSON.stringify(row)).join('\n')
    writeFileSync(this.filePath, rows.length > 0 ? `${body}\n` : '')
  }

  /**
   * Re-arm fired intents whose cooldown elapsed and that still have fires
   * left. Returns the rows after the transition (persisting when it changed).
   */
  private maintainLifecycle(rows: StandingIntentRow[], nowMs: number): StandingIntentRow[] {
    let changed = false
    const next = rows.map((row) => {
      if (row.status !== 'fired' || row.fireCount >= row.maxFires) return row
      const lastFired = row.lastFiredAt ? Date.parse(row.lastFiredAt) : Number.NaN
      if (!Number.isFinite(lastFired) || lastFired + row.cooldownSeconds * 1_000 > nowMs) return row
      changed = true
      return { ...row, status: 'armed' as StandingIntentStatus }
    })
    if (changed) this.write(next)
    return next
  }

  /** All intents (lifecycle-maintained), oldest first. */
  list(): StandingIntent[] {
    return this.maintainLifecycle(this.read(), this.clock()).map((row) => ({ ...row }))
  }

  /** Currently armed intents only — the matcher's candidate set. */
  listArmed(): StandingIntent[] {
    return this.list().filter((intent) => intent.status === 'armed')
  }

  /**
   * Create an intent. Returns null when the text is a pure time-based reminder
   * — those belong to cron, not prospective memory.
   */
  add(input: StandingIntentAddInput): StandingIntent | null {
    const text = input.text.trim()
    const trigger = input.trigger.trim()
    if (!text || !trigger) return null
    if (isTimeOnlyIntent(text) || isTimeOnlyIntent(trigger)) return null
    const row: StandingIntentRow = {
      id: randomUUID(),
      text,
      trigger,
      createdAt: input.ts ?? new Date(this.clock()).toISOString(),
      status: 'armed',
      fireCount: 0,
      maxFires: input.maxFires ?? DEFAULT_MAX_FIRES,
      cooldownSeconds: input.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
      provenance: input.provenance,
    }
    const rows = this.read()
    rows.push(row)
    this.write(rows)
    return { ...row }
  }

  /** Cancel (disable) one intent. Returns the updated intent, or null. */
  cancel(id: string): StandingIntent | null {
    const rows = this.read()
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) return null
    const row = rows[index]!
    if (row.status === 'cancelled') return { ...row }
    const updated: StandingIntentRow = { ...row, status: 'cancelled' }
    rows[index] = updated
    this.write(rows)
    return { ...updated }
  }

  /**
   * Mark intents as fired: bump fireCount, stamp lastFiredAt and flip to
   * `done` once maxFires is reached. Unknown/already-advanced ids are skipped.
   * Returns the updated intents.
   */
  markFired(ids: readonly string[], nowMs: number = this.clock()): StandingIntent[] {
    const wanted = new Set(ids)
    if (wanted.size === 0) return []
    const ts = new Date(nowMs).toISOString()
    const fired: StandingIntent[] = []
    const rows = this.read().map((row) => {
      if (!wanted.has(row.id) || row.status !== 'armed') return row
      const fireCount = row.fireCount + 1
      const updated: StandingIntentRow = {
        ...row,
        fireCount,
        lastFiredAt: ts,
        status: fireCount >= row.maxFires ? 'done' : 'fired',
      }
      fired.push({ ...updated })
      return updated
    })
    if (fired.length > 0) this.write(rows)
    return fired
  }
}