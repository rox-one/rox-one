/**
 * Bridge from Hindsight's SQLite output into the intelligence database.
 *
 * One staged profile in, one ingest out. The intermediate `.sqlite` (plus its
 * WAL sidecars) is deleted after ingest because staging already isolated the
 * source databases and the parsed facts now live in `fact_visits`; keeping the
 * full forensic output around would double the pipeline's disk footprint.
 *
 * Every step is idempotent: `insertVisits` de-duplicates on
 * `(profile, url, visit_time, transition)`, so re-running the bridge over an
 * unchanged profile adds no rows and reports the same counts.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { stagingDirNameForProfile } from '../paths.ts'
import type { IntelligenceStore } from '../db/repositories.ts'
import type {
  HindsightIngestResult,
  HindsightRunOptions,
  HindsightRunResult,
  StagedProfile,
} from '../types.ts'
import { parseHindsightSqlite } from './parser.ts'

/** Meta key holding the receipt of the most recent successful ingest. */
export const HINDSIGHT_META_KEY = 'last_hindsight_run'

export interface IngestHindsightInput {
  store: IntelligenceStore
  sqlitePath: string
  profileId: string
  now?: number
}

export interface HindsightBridgeOutcome {
  runs: HindsightRunResult[]
  ingests: HindsightIngestResult[]
  errors: string[]
}

/** Structural runner seam so tests can inject a fake without spawning. */
export interface HindsightRunnerLike {
  run(options: HindsightRunOptions): Promise<HindsightRunResult>
}

export interface HindsightBridgeOptions {
  store: IntelligenceStore
  runner: HindsightRunnerLike
  /** Directory for the intermediate SQLite files (usually the intelligence dir). */
  outputDir: string
  now?: () => number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Parse one Hindsight SQLite file into the store.
 *
 * The counts describe the *parsed* output, not the freshly inserted rows, so a
 * repeated call over the same file returns the same numbers while the database
 * stays unchanged.
 */
export function ingestHindsightOutput(input: IngestHindsightInput): HindsightIngestResult {
  const now = input.now ?? Date.now()
  const parsed = parseHindsightSqlite(input.sqlitePath, { profileId: input.profileId })

  const visits = input.store.insertVisits(parsed.visits, now)
  const bookmarksMarked = input.store.markBookmarks(parsed.bookmarks, now)

  // `recordProfileIngest` adds cumulative deltas: a repeat ingest that inserted
  // no new visits must not inflate the profile's counters, so the bookmark
  // contribution is only recorded alongside newly inserted visits.
  input.store.recordProfileIngest(
    input.profileId,
    { visits: visits.inserted, bookmarks: visits.inserted > 0 ? bookmarksMarked : 0 },
    now,
  )
  input.store.setMeta(
    HINDSIGHT_META_KEY,
    JSON.stringify({
      at: now,
      profileId: input.profileId,
      sqlitePath: input.sqlitePath,
      visits: parsed.visits.length,
      bookmarks: parsed.bookmarks.length,
      profiles: parsed.profiles,
    }),
    now,
  )

  return {
    profileId: input.profileId,
    visits: parsed.visits.length,
    bookmarks: parsed.bookmarks.length,
    urlsEnqueued: visits.urls,
    skipped: parsed.skipped,
    errors: [],
  }
}

export class HindsightBridge {
  readonly #store: IntelligenceStore
  readonly #runner: HindsightRunnerLike
  readonly #outputDir: string
  readonly #now: () => number

  constructor(options: HindsightBridgeOptions) {
    this.#store = options.store
    this.#runner = options.runner
    this.#outputDir = options.outputDir
    this.#now = options.now ?? (() => Date.now())
  }

  /**
   * Run Hindsight over every staged profile and ingest the results.
   *
   * A failure for one profile is recorded in `errors` and must not prevent the
   * remaining profiles from being processed. The staged source is a live
   * database, so an occasional per-profile Hindsight failure is expected.
   */
  async runForStaged(staged: readonly StagedProfile[]): Promise<HindsightBridgeOutcome> {
    const runs: HindsightRunResult[] = []
    const ingests: HindsightIngestResult[] = []
    const errors: string[] = []

    for (const profile of staged) {
      const outputBase = join(this.#outputDir, stagingDirNameForProfile(profile.profileId))
      let producedPath = `${outputBase}.sqlite`
      try {
        const run = await this.#runner.run({ input: profile.stagingDir, outputBase, noCopy: true })
        producedPath = run.outputPath
        runs.push(run)
        const ingest = ingestHindsightOutput({
          store: this.#store,
          sqlitePath: run.outputPath,
          profileId: profile.profileId,
          now: this.#now(),
        })
        ingests.push(ingest)
        errors.push(...ingest.errors)
      } catch (error) {
        errors.push(`${profile.profileId}: ${errorMessage(error)}`)
      } finally {
        // Remove every SQLite sidecar: a crashed run can leave a hot rollback
        // `-journal` (the staged input is a live database) and a later retry
        // must never read a stale, half-rolled-back output.
        for (const path of [producedPath, `${producedPath}-wal`, `${producedPath}-shm`, `${producedPath}-journal`]) {
          try {
            rmSync(path, { force: true })
          } catch {
            // A leftover intermediate file must not fail the run.
          }
        }
      }
    }

    return { runs, ingests, errors }
  }
}