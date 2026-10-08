/**
 * Integration tests for the Electron Browser Intelligence runtime.
 *
 * The tests isolate the config dir through `ROX_CONFIG_DIR` (the pipeline
 * resolves its layout lazily, so an env override set before the first call is
 * honoured) and drive the pipeline through the `__setPipelineDepsForTests`
 * seam instead of touching real browser profiles.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import type {
  DetectedBrowser,
  PipelineDeps,
  ScannedBrowserProfile,
  StagedProfile,
  UnfurlBatchOutcome,
} from '@rox/browser-intel'

const configDir = mkdtempSync(join(tmpdir(), 'rox-browser-intel-'))
process.env.ROX_CONFIG_DIR = configDir

const { COGNITIVE_PROFILE_BASENAME, resolveBrowserIntelPaths } = await import('@rox/browser-intel')
const runtime = await import('../browser-intel/index.ts')

const paths = resolveBrowserIntelPaths(configDir)

const DETECTED: DetectedBrowser = {
  vendor: 'chrome',
  family: 'chromium',
  displayName: 'Chrome',
  platform: 'darwin',
  rootPath: join(configDir, 'chrome'),
  executablePath: null,
  version: '1',
}

const PROFILE: ScannedBrowserProfile = {
  profileId: 'chromium:Default',
  vendor: 'chrome',
  family: 'chromium',
  displayName: 'Chrome',
  name: 'Default',
  path: join(configDir, 'chrome', 'Default'),
  lastUsedAt: null,
  state: 'ok',
  stores: { history: join(configDir, 'History'), bookmarks: null, places: null, cookies: null },
}

const STAGED: StagedProfile = {
  profileId: PROFILE.profileId,
  vendor: 'chrome',
  family: 'chromium',
  stagingDir: join(configDir, 'staging'),
  stagedAt: Date.now(),
  files: [],
  missing: ['bookmarks', 'places', 'cookies'],
  totalBytes: 0,
  copiedInMs: 0,
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    detect: () => [DETECTED],
    scan: () => [PROFILE],
    stage: async () => STAGED,
    runHindsight: async () => ({ runs: [], ingests: [], errors: [] }),
    runUnfurl: async () => ({ batches: 0, processed: 0, failed: 0, pendingRemaining: 0, cpuMsTotal: 0 }),
    ...overrides,
  }
}

async function waitForRun(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (runtime.getBrowserIntelStateSnapshot().lastRunAt !== null) return
    await delay(10)
  }
  throw new Error('browser-intel run did not complete in time')
}

beforeEach(() => {
  runtime.disposeBrowserIntelRuntime()
  runtime.__setPipelineDepsForTests(null)
})

afterAll(() => {
  runtime.disposeBrowserIntelRuntime()
  rmSync(configDir, { recursive: true, force: true })
})

describe('browser-intel runtime', () => {
  test('consent off: start refuses and creates no files', () => {
    rmSync(paths.statePath, { force: true })
    rmSync(paths.intelligenceDir, { recursive: true, force: true })

    expect(runtime.startBrowserIntelRun()).toEqual({ started: false })
    expect(existsSync(paths.statePath)).toBe(false)
    expect(existsSync(paths.dbPath)).toBe(false)
    expect(existsSync(paths.intelligenceDir)).toBe(false)
  })

  test('stats and slot snapshots are zeroed when no database exists', () => {
    const stats = runtime.getBrowserIntelStatsSnapshot()
    expect(stats).toEqual({
      profiles: 0,
      profilesByVendor: [],
      urls: 0,
      urlsPending: 0,
      urlsUnfurled: 0,
      urlsFailed: 0,
      visits: 0,
      bookmarks: 0,
      searches: 0,
      firstVisitAt: null,
      lastVisitAt: null,
      unfurlDetails: 0,
      slots: 0,
      dbBytes: null,
      lastIngestAt: null,
      lastUnfurlAt: null,
    })
    expect(runtime.getBrowserIntelSlotsSnapshot()).toEqual([])
  })

  test('consent on: emits progress, persists state and rejects a second concurrent start', async () => {
    const { promise: unfurlGate, resolve: releaseUnfurl } = Promise.withResolvers<UnfurlBatchOutcome>()
    runtime.__setPipelineDepsForTests(makeDeps({ runUnfurl: () => unfurlGate }))

    const before = await runtime.setBrowserIntelConsentAndSync(true)
    expect(before.consent).toBe(true)

    const events: Array<{ type: string; state?: { lastRunAt: number | null } }> = []
    const unsubscribe = runtime.onBrowserIntelEvent((event) => {
      events.push(event.type === 'state' ? { type: event.type, state: event.state } : { type: event.type })
    })

    expect(runtime.startBrowserIntelRun()).toEqual({ started: true })
    expect(runtime.startBrowserIntelRun()).toEqual({ started: false })

    releaseUnfurl()
    await waitForRun()
    unsubscribe()

    const stages = events.filter((event) => event.type === 'progress')
    expect(stages.length).toBeGreaterThan(0)
    expect(events.some((event) => event.type === 'state' && event.state?.lastRunAt !== null)).toBe(true)

    const persisted = runtime.getBrowserIntelStateSnapshot()
    expect(typeof persisted.lastRunAt).toBe('number')
    expect(persisted.lastResult?.profiles).toBe(1)
    expect(existsSync(paths.dbPath)).toBe(true)
  })

  test('revoking consent clears the cached profile and emits a state event', async () => {
    await runtime.setBrowserIntelConsentAndSync(true)

    mkdirSync(paths.intelligenceDir, { recursive: true })
    const cachePath = join(paths.intelligenceDir, COGNITIVE_PROFILE_BASENAME)
    writeFileSync(cachePath, '<user_cognitive_profile>\n- tech_stack: TypeScript\n</user_cognitive_profile>')

    const events: Array<{ type: string; consent?: boolean }> = []
    const unsubscribe = runtime.onBrowserIntelEvent((event) => {
      events.push(event.type === 'state' ? { type: event.type, consent: event.state.consent } : { type: event.type })
    })

    const state = await runtime.setBrowserIntelConsentAndSync(false)
    unsubscribe()

    expect(state.consent).toBe(false)
    expect(existsSync(cachePath)).toBe(false)
    expect(events.some((event) => event.type === 'state' && event.consent === false)).toBe(true)
  })
})