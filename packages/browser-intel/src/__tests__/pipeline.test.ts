/**
 * End-to-end pipeline test with mocked device boundaries.
 *
 * The device-facing stages (browser detection, profile scanning, shadow copy,
 * the forensic subprocess) are injected, while everything downstream is real:
 * a real `IntelligenceStore` on a real SQLite file, the real unfurl batch
 * runner, real rollups, real slot synthesis and the real prompt-block cache.
 * That combination is what proves the stages agree on the schema, the URL
 * deduplication key and the consent gate.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { IntelligenceStore } from '../db/repositories.ts'
import { readCognitiveProfileCache } from '../insights/cognitiveProfile.ts'
import { resolveBrowserIntelPaths } from '../paths.ts'
import { runIntelligencePipeline, runIntelligencePipelineIfConsented } from '../pipeline.ts'
import { runUnfurlBatches } from '../workers/unfurlWorker.ts'
import { setBrowserIntelConsent } from '../state.ts'
import type {
  DetectedBrowser,
  PipelineOptions,
  PipelineProgress,
  ScannedBrowserProfile,
  StagedProfile,
  VisitRecord,
} from '../types.ts'

const NOW = 1_783_910_847_938
const roots: string[] = []

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-intel-pipeline-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function detectedBrowser(): DetectedBrowser {
  return {
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Google Chrome',
    platform: 'darwin',
    rootPath: '/virtual/Chrome',
    executablePath: null,
    version: null,
  }
}

function scannedProfile(state: ScannedBrowserProfile['state'] = 'ok'): ScannedBrowserProfile {
  return {
    profileId: 'chromium:/virtual/Chrome/Default',
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Google Chrome',
    name: 'Default',
    path: '/virtual/Chrome/Default',
    lastUsedAt: null,
    state,
    stores: { history: '/virtual/Chrome/Default/History', bookmarks: null, places: null, cookies: null },
  }
}

function staged(profile: ScannedBrowserProfile, files = 1): StagedProfile {
  return {
    profileId: profile.profileId,
    vendor: profile.vendor,
    family: profile.family,
    stagingDir: `/staging/${profile.profileId.replace(/[^a-z0-9]+/gi, '-')}`,
    stagedAt: NOW,
    files: Array.from({ length: files }, (_, index) => ({
      kind: 'history' as const,
      sourcePath: profile.stores.history ?? '',
      stagedPath: `/staging/History-${index}`,
      bytes: 1024,
      sha256: 'a'.repeat(64),
      mtimeMs: NOW,
    })),
    missing: files > 0 ? ['bookmarks', 'places'] : ['history', 'bookmarks', 'places', 'cookies'],
    totalBytes: files * 1024,
    copiedInMs: 5,
  }
}

function visits(): VisitRecord[] {
  return [
    {
      profileId: 'chromium:/virtual/Chrome/Default',
      url: 'https://github.com/rox-one/rox-one?tab=readme',
      title: 'rox-one',
      visitTime: NOW,
      transitionType: 'link',
      visitDuration: 12_000,
      visitSource: 'Synced',
      visitCount: 3,
      typedCount: 1,
      isBookmark: false,
      searchQuery: null,
    },
    {
      profileId: 'chromium:/virtual/Chrome/Default',
      url: 'https://www.google.com/search?q=sqlite+wal+mode',
      title: 'sqlite wal mode - Google Search',
      visitTime: NOW + 60_000,
      transitionType: 'typed',
      visitDuration: null,
      visitSource: 'Local',
      visitCount: 1,
      typedCount: 1,
      isBookmark: false,
      searchQuery: 'sqlite wal mode',
    },
  ]
}

interface Harness {
  configDir: string
  dbPath: string
  progress: PipelineProgress[]
  errors: string[]
  options: PipelineOptions
  deps: NonNullable<Parameters<typeof runIntelligencePipeline>[1]>
}

function harness(overrides: Partial<PipelineOptions> = {}): Harness {
  const configDir = tempConfigDir()
  const dbPath = join(configDir, 'intelligence', 'intelligence.db')
  const progress: PipelineProgress[] = []
  const errors: string[] = []
  let store: IntelligenceStore | null = null
  const options: PipelineOptions = {
    consent: true,
    configDir,
    now: () => NOW,
    onProgress: (event) => progress.push(event),
    ...overrides,
  }
  const deps: NonNullable<Parameters<typeof runIntelligencePipeline>[1]> = {
    detect: () => [detectedBrowser()],
    scan: () => [scannedProfile()],
    stage: async (profile) => staged(profile),
    runHindsight: async (stagedProfiles) => {
      store?.insertVisits(visits(), NOW)
      return {
        runs: stagedProfiles.map((entry) => ({
          outputPath: `${entry.stagingDir}.sqlite`,
          format: 'sqlite' as const,
          exitCode: 0,
          durationMs: 3,
          stdout: '',
          stderr: '',
          profilesDetected: [entry.profileId],
        })),
        ingests: stagedProfiles.map((entry) => ({
          profileId: entry.profileId,
          visits: visits().length,
          bookmarks: 0,
          urlsEnqueued: visits().length,
          skipped: 0,
          errors: [],
        })),
        errors,
      }
    },
    openStore: (resolved) => {
      store = new IntelligenceStore(resolved.dbPath)
      return store
    },
  }
  return { configDir, dbPath, progress, errors, options, deps }
}

describe('runIntelligencePipeline', () => {
  test('refuses to touch the device without consent', async () => {
    const { configDir, dbPath, options, deps } = harness({ consent: false })
    let scanned = false
    const result = await runIntelligencePipeline(options, {
      ...deps,
      scan: () => {
        scanned = true
        return []
      },
    })
    expect(scanned).toBe(false)
    expect(result.profiles).toHaveLength(0)
    expect(result.errors.join(' ')).toContain('consent')
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(join(configDir, 'cache'))).toBe(false)
  })

  test('runs every stage and persists the aggregated result', async () => {
    const { configDir, dbPath, progress, options, deps } = harness()
    const result = await runIntelligencePipeline(options, deps)

    expect(result.errors).toEqual([])
    expect(result.detected).toHaveLength(1)
    expect(result.profiles).toHaveLength(1)
    expect(result.staged).toHaveLength(1)
    expect(result.hindsight).toHaveLength(1)
    expect(result.ingested[0]?.visits).toBe(2)

    // Stage order is the contract the UI progress indicator relies on.
    const stages = [...new Set(progress.map((event) => event.stage))]
    expect(stages).toEqual(['detect', 'scan', 'stage', 'hindsight', 'ingest', 'unfurl', 'aggregate', 'synthesize'])

    const store = new IntelligenceStore(dbPath, { readOnly: true })
    try {
      const stats = store.readStats(dbPath)
      expect(stats.profiles).toBe(1)
      expect(stats.visits).toBe(2)
      expect(stats.urls).toBe(2)
      expect(stats.searches).toBe(1)
      expect(stats.urlsUnfurled).toBeGreaterThan(0)
      expect(store.readTimeline('daily').length).toBeGreaterThan(0)
      expect(store.readSlots().length).toBeGreaterThan(0)
    } finally {
      store.close()
    }

    // The prompt cache is what the OMP spawn path reads.
    const block = readCognitiveProfileCache(resolveBrowserIntelPaths(configDir))
    expect(readFileSync(join(configDir, 'browser-intel.json'), 'utf8')).toContain('lastRunAt')
    expect(block.length === 0 || block.includes('<user_cognitive_profile>')).toBe(true)
  })

  test('isolates a failing stage instead of aborting the run', async () => {
    const { options, deps } = harness()
    const result = await runIntelligencePipeline(options, {
      ...deps,
      stage: async (profile) => {
        if (profile.name === 'Default') throw new Error('disk full')
        return staged(profile)
      },
    })
    expect(result.errors.join(' ')).toContain('disk full')
    expect(result.staged).toHaveLength(0)
    expect(result.errors.join(' ')).toContain('No profile could be staged')
  })

  test('skips the forensic run for a profile with no readable store', async () => {
    const { options, deps } = harness()
    let forensicCalls = 0
    const result = await runIntelligencePipeline(options, {
      ...deps,
      stage: async (profile) => staged(profile, 0),
      runHindsight: async () => {
        forensicCalls += 1
        return { runs: [], ingests: [], errors: [] }
      },
    })
    expect(forensicCalls).toBe(0)
    // Reported as a profile whose every store is missing, not as a failure.
    expect(result.errors).toEqual([])
    expect(result.staged[0]?.missing).toEqual(['history', 'bookmarks', 'places', 'cookies'])
  })

  test('runs the real unfurl worker over enqueued URLs when not injected', async () => {
    const { configDir, dbPath, options, deps } = harness()
    await runIntelligencePipeline({ ...options, skipUnfurl: true }, deps)
    // Second pass: real in-process worker against the URLs the first pass left pending.
    const store = new IntelligenceStore(dbPath)
    try {
      const outcome = await runUnfurlBatches({ dbPath, store, batchSize: 100, batchDelayMs: 0 })
      expect(outcome.processed).toBe(2)
      expect(outcome.failed).toBe(0)
      const stats = store.readStats(dbPath)
      expect(stats.urlsUnfurled).toBe(2)
      expect(stats.urlsPending).toBe(0)
    } finally {
      store.close()
    }
    expect(existsSync(join(configDir, 'intelligence', 'intelligence.db'))).toBe(true)
  })

  test('runIntelligencePipelineIfConsented follows the persisted switch', async () => {
    const configDir = tempConfigDir()
    expect(await runIntelligencePipelineIfConsented({ configDir }, harness().deps)).toBeNull()
    setBrowserIntelConsent(true, configDir, NOW)
    const deps = harness().deps
    const result = await runIntelligencePipelineIfConsented({ configDir }, deps)
    expect(result).not.toBeNull()
    expect(result?.profiles).toHaveLength(1)
  })
})