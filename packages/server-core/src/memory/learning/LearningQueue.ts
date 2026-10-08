/**
 * Durable learning job queue (PRD §33) backed by a `queue.jsonl` LearningStore.
 *
 * One row per job, keyed by the deterministic `jobId` `<type>:<sourceId>`, so
 * enqueueing the same work twice never duplicates a row. Timestamps are epoch
 * milliseconds and survive process restarts because the underlying
 * LearningStore re-reads the file on every listing.
 */
import { LearningStore } from './LearningStore'

export type LearningJobType =
  | 'session_reflection'
  | 'consolidation'
  | 'skill_curation'
  | 'policy_learning'
  | 'garbage_collection'
  | 'outcome_evaluation'

export type LearningJobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface LearningJobRow {
  /** LearningStore identity; always equal to `jobId`. */
  id: string
  jobId: string
  type: LearningJobType
  sourceId: string
  status: LearningJobStatus
  attempt: number
  createdAt: number
  updatedAt: number
  /** Earliest time the job may run (epoch ms); defaults to `createdAt`. */
  notBefore?: number
  lastError?: string
}

export interface LearningQueueStatusCounts {
  pending: number
  running: number
  done: number
  failed: number
  total: number
}

export interface EnqueueJobOptions {
  /** Earliest run time; defaults to `at` (or now). */
  notBefore?: number
  /** Override "now" for deterministic tests. */
  at?: number
}

/** Deterministic job identity (PRD §33): `<type>:<sourceId>`. */
export function learningJobId(type: LearningJobType, sourceId: string): string {
  return `${type}:${sourceId}`
}

export class LearningQueue {
  private readonly store: LearningStore<LearningJobRow>

  constructor(filePath: string) {
    this.store = new LearningStore<LearningJobRow>(filePath)
  }

  /** All rows (fail-soft: corrupt lines are skipped by LearningStore). */
  list(): LearningJobRow[] {
    return this.store.list()
  }

  get(jobId: string): LearningJobRow | null {
    return this.store.get(jobId)
  }

  /**
   * Idempotent enqueue. An existing `pending`/`running` job with the same
   * deterministic jobId is returned untouched (no duplicate row). A `done` or
   * `failed` row is replaced by a fresh pending job that keeps `createdAt`.
   */
  enqueue(type: LearningJobType, sourceId: string, opts: EnqueueJobOptions = {}): LearningJobRow {
    const now = opts.at ?? Date.now()
    const jobId = learningJobId(type, sourceId)
    const existing = this.store.get(jobId)
    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      return existing
    }
    const row: LearningJobRow = {
      id: jobId,
      jobId,
      type,
      sourceId,
      status: 'pending',
      attempt: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notBefore: opts.notBefore ?? now,
    }
    return this.store.save(row)
  }

  markRunning(jobId: string, at: number = Date.now()): LearningJobRow | null {
    return this.update(jobId, { status: 'running' }, at)
  }

  markDone(jobId: string, at: number = Date.now()): LearningJobRow | null {
    return this.update(jobId, { status: 'done', notBefore: undefined, lastError: undefined }, at)
  }

  markFailed(
    jobId: string,
    error?: string,
    opts: { attempt?: number; at?: number } = {},
  ): LearningJobRow | null {
    return this.update(
      jobId,
      {
        status: 'failed',
        lastError: error,
        ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
      },
      opts.at ?? Date.now(),
    )
  }

  /** Return a job to `pending`, optionally bumping the attempt counter. */
  reschedule(
    jobId: string,
    notBefore: number,
    error?: string,
    opts: { attempt?: number; at?: number } = {},
  ): LearningJobRow | null {
    return this.update(
      jobId,
      {
        status: 'pending',
        notBefore,
        lastError: error,
        ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
      },
      opts.at ?? Date.now(),
    )
  }

  /** Pending jobs whose `notBefore ?? createdAt` is at or before `now`. */
  listDue(now: number): LearningJobRow[] {
    return this.list()
      .filter((row) => row.status === 'pending' && (row.notBefore ?? row.createdAt) <= now)
      .sort((a, b) => {
        const aAt = a.notBefore ?? a.createdAt
        const bAt = b.notBefore ?? b.createdAt
        if (aAt !== bAt) return aAt - bAt
        return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0
      })
  }

  statusCounts(): LearningQueueStatusCounts {
    const counts: LearningQueueStatusCounts = { pending: 0, running: 0, done: 0, failed: 0, total: 0 }
    for (const row of this.list()) {
      counts.total += 1
      if (row.status === 'pending' || row.status === 'running' || row.status === 'done' || row.status === 'failed') {
        counts[row.status] += 1
      }
    }
    return counts
  }

  private update(jobId: string, patch: Partial<LearningJobRow>, at: number): LearningJobRow | null {
    const existing = this.store.get(jobId)
    if (!existing) return null
    const next: LearningJobRow = { ...existing, ...patch, id: jobId, jobId, updatedAt: at }
    return this.store.save(next)
  }
}