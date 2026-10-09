import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

import { IntelligenceStore } from '../../db/repositories.ts'
import { stagingDirNameForProfile } from '../../paths.ts'
import { HINDSIGHT_META_KEY, HindsightBridge, type HindsightRunnerLike } from '../bridge.ts'
import type { HindsightRunOptions, HindsightRunResult, ScannedBrowserProfile, StagedProfile } from '../../types.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-browser-intel-bridge-'))
  roots.push(root)
  return root
}

/** Write a small but schema-real Hindsight output at `<outputBase>.sqlite`. */
function writeFakeSqlite(outputBase: string): string {
  const path = `${outputBase}.sqlite`
  const db = new DatabaseSync(path)
  db.exec(
    `CREATE TABLE timeline (type TEXT, timestamp TEXT, url TEXT, title TEXT, profile TEXT,
       transition TEXT, visit_source TEXT, visit_count INTEGER, typed_count INTEGER, visit_duration TEXT)`,
  )
  const insert = db.prepare(
    `INSERT INTO timeline (type, timestamp, url, title, profile, transition, visit_source, visit_count, typed_count, visit_duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(
    'url',
    '2026-07-13 02:47:27.938',
    'https://example.com/page',
    'Example',
    '/staged',
    'link; ',
    'BROWSED',
    3,
    1,
    '0:03:12.345678',
  )
  insert.run('bookmark', '2026-07-13T04:05:06Z', 'https://example.com/page', 'Example', '/staged', null, null, null, null, null)
  insert.run('cookie (created)', '2026-07-13 05:00:00', null, null, '/staged', null, null, null, null, null)
  db.close()
  return path
}

class FakeRunner implements HindsightRunnerLike {
  readonly #failInputs: Set<string>

  constructor(failInputs: Set<string> = new Set()) {
    this.#failInputs = failInputs
  }

  async run(options: HindsightRunOptions): Promise<HindsightRunResult> {
    if (this.#failInputs.has(options.input)) throw new Error(`hindsight failed for ${options.input}`)
    const outputPath = writeFakeSqlite(options.outputBase)
    return { outputPath, format: 'sqlite', exitCode: 0, durationMs: 3, stdout: '', stderr: '', profilesDetected: [] }
  }
}

/** Simulates a crashed run: writes the output plus sidecars, then throws. */
class CrashRunner implements HindsightRunnerLike {
  async run(options: HindsightRunOptions): Promise<HindsightRunResult> {
    const outputPath = writeFakeSqlite(options.outputBase)
    for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(`${outputPath}${suffix}`, 'stale')
    throw new Error('hindsight crashed')
  }
}

function scanned(profileId: string, path: string): ScannedBrowserProfile {
  return {
    profileId,
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Google Chrome',
    name: 'Default',
    path,
    lastUsedAt: null,
    state: 'ok',
    stores: { history: null, bookmarks: null, places: null, cookies: null },
  }
}

function staged(profileId: string, stagingDir: string): StagedProfile {
  return {
    profileId,
    vendor: 'chrome',
    family: 'chromium',
    stagingDir,
    stagedAt: 0,
    files: [],
    missing: [],
    totalBytes: 0,
    copiedInMs: 0,
  }
}

const SCHEMA_PATH = join(import.meta.dir, '..', '..', 'db', 'schema.sql')

describe('HindsightBridge', () => {
  test('ingests every staged profile and is idempotent on re-run', async () => {
    const root = tempRoot()
    const store = new IntelligenceStore(join(root, 'intelligence.db'), { schemaPath: SCHEMA_PATH })
    const a = staged('chromium:/a', join(root, 'a'))
    const b = staged('chromium:/b', join(root, 'b'))
    store.upsertProfiles([scanned(a.profileId, a.stagingDir), scanned(b.profileId, b.stagingDir)])

    const outputDir = join(root, 'out')
    mkdirSync(outputDir, { recursive: true })
    const bridge = new HindsightBridge({ store, runner: new FakeRunner(), outputDir, now: () => 1000 })

    const first = await bridge.runForStaged([a, b])
    expect(first.errors).toEqual([])
    expect(first.ingests).toHaveLength(2)
    expect(first.runs).toHaveLength(2)

    const statsFirst = store.readStats()
    expect(statsFirst.visits).toBe(2)
    expect(statsFirst.bookmarks).toBe(2)
    expect(store.getMeta(HINDSIGHT_META_KEY)).not.toBeNull()

    // Intermediate outputs are removed.
    for (const profile of [a, b]) {
      expect(existsSync(join(outputDir, `${stagingDirNameForProfile(profile.profileId)}.sqlite`))).toBe(false)
    }

    const second = await bridge.runForStaged([a, b])
    const counts = (result: typeof first): Array<Record<string, unknown>> =>
      result.ingests.map((ingest) => ({
        visits: ingest.visits,
        bookmarks: ingest.bookmarks,
        urlsEnqueued: ingest.urlsEnqueued,
        skipped: ingest.skipped,
      }))
    expect(counts(second)).toEqual(counts(first))

    const statsSecond = store.readStats()
    expect(statsSecond.visits).toBe(statsFirst.visits)
    expect(statsSecond.bookmarks).toBe(statsFirst.bookmarks)
    store.close()
  })

  test('isolates a failing profile from the rest', async () => {
    const root = tempRoot()
    const store = new IntelligenceStore(join(root, 'intelligence.db'), { schemaPath: SCHEMA_PATH })
    const good = staged('chromium:/good', join(root, 'good'))
    const bad = staged('chromium:/bad', join(root, 'bad'))
    store.upsertProfiles([scanned(good.profileId, good.stagingDir), scanned(bad.profileId, bad.stagingDir)])

    const outputDir = join(root, 'out')
    mkdirSync(outputDir, { recursive: true })
    const bridge = new HindsightBridge({
      store,
      runner: new FakeRunner(new Set([bad.stagingDir])),
      outputDir,
      now: () => 1000,
    })

    const result = await bridge.runForStaged([bad, good])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('chromium:/bad')
    expect(result.ingests).toHaveLength(1)
    expect(result.ingests[0]!.profileId).toBe('chromium:/good')
    expect(store.readStats().visits).toBe(1)
    store.close()
  })

  test('removes the sqlite and every sidecar after a crashed run', async () => {
    const root = tempRoot()
    const store = new IntelligenceStore(join(root, 'intelligence.db'), { schemaPath: SCHEMA_PATH })
    const profile = staged('chromium:/crash', join(root, 'crash'))
    store.upsertProfiles([scanned(profile.profileId, profile.stagingDir)])

    const outputDir = join(root, 'out')
    mkdirSync(outputDir, { recursive: true })
    const bridge = new HindsightBridge({ store, runner: new CrashRunner(), outputDir, now: () => 1000 })

    const result = await bridge.runForStaged([profile])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('hindsight crashed')

    const base = `${join(outputDir, stagingDirNameForProfile(profile.profileId))}.sqlite`
    for (const path of [base, `${base}-wal`, `${base}-shm`, `${base}-journal`]) {
      expect(existsSync(path)).toBe(false)
    }
    store.close()
  })
})