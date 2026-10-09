/**
 * End-to-end orchestration of the Browser Intelligence Pipeline.
 *
 * Stage order is fixed: detect -> scan -> stage -> hindsight -> ingest ->
 * unfurl -> aggregate -> synthesize. Each stage degrades independently: a
 * profile whose store cannot be copied is skipped, a Hindsight failure for one
 * profile does not stop the others, and the insight stage still runs from
 * whatever visits were ingested. The caller gets every failure back in
 * `PipelineResult.errors` rather than an exception, because the UI needs to
 * report partial success.
 *
 * Consent is enforced here, not in the callers: with `consent: false` the
 * pipeline returns immediately without touching a single browser file.
 */

import { IntelligenceStore } from './db/repositories.ts'
import { detectBrowsers } from './acquisition/browserDetector.ts'
import { scanProfiles } from './acquisition/profileScanner.ts'
import { shadowCopyProfile } from './acquisition/shadowCopy.ts'
import { HindsightBridge } from './hindsight/bridge.ts'
import { HindsightRunner } from './hindsight/runner.ts'
import { aggregateMetrics } from './insights/aggregate.ts'
import { synthesizeSlots } from './insights/synthesis.ts'
import { writeCognitiveProfileCache } from './insights/cognitiveProfile.ts'
import { runUnfurlBatches } from './workers/unfurlWorker.ts'
import { resolveBrowserIntelPaths, type BrowserIntelPaths } from './paths.ts'
import { readBrowserIntelState, recordBrowserIntelError, recordBrowserIntelRun } from './state.ts'
import type {
  DetectedBrowser,
  HindsightIngestResult,
  HindsightRunResult,
  PipelineOptions,
  PipelineProgress,
  PipelineResult,
  PipelineStage,
  ScannedBrowserProfile,
  StagedProfile,
  SynthesisResult,
  TimelineRollupResult,
  UnfurlBatchOutcome,
} from './types.ts'

/** Injection seam so tests and the Electron shell can replace heavy stages. */
export interface PipelineDeps {
  detect?: (options: { home?: string; platform?: NodeJS.Platform }) => DetectedBrowser[]
  scan?: (options: { home?: string; platform?: NodeJS.Platform; vendors?: PipelineOptions['vendors'] }) => ScannedBrowserProfile[]
  stage?: (profile: ScannedBrowserProfile, paths: BrowserIntelPaths) => Promise<StagedProfile>
  runHindsight?: (staged: readonly StagedProfile[], paths: BrowserIntelPaths) => Promise<{
    runs: HindsightRunResult[]
    ingests: HindsightIngestResult[]
    errors: string[]
  }>
  runUnfurl?: PipelineOptions['runUnfurl']
  openStore?: (paths: BrowserIntelPaths) => IntelligenceStore
  now?: () => number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runIntelligencePipeline(
  options: PipelineOptions,
  deps: PipelineDeps = {},
): Promise<PipelineResult> {
  const now = options.now ?? deps.now ?? (() => Date.now())
  const startedAt = now()
  const paths = resolveBrowserIntelPaths(options.configDir)
  const errors: string[] = []
  const progress = (stage: PipelineStage, message: string, current: number, total: number): void => {
    options.onProgress?.({ stage, message, current, total, startedAt })
  }

  const empty: PipelineResult = {
    detected: [],
    profiles: [],
    staged: [],
    hindsight: [],
    ingested: [],
    rollups: null,
    synthesis: null,
    errors,
    startedAt,
    finishedAt: startedAt,
  }

  if (!options.consent) {
    errors.push('Browser intelligence consent is not granted; nothing was scanned.')
    return { ...empty, finishedAt: now() }
  }

  const detect = deps.detect ?? ((input: { home?: string; platform?: NodeJS.Platform }) => detectBrowsers(input))
  const scan =
    deps.scan ??
    ((input: { home?: string; platform?: NodeJS.Platform; vendors?: PipelineOptions['vendors'] }) => scanProfiles(input))
  const stage =
    deps.stage ??
    ((profile: ScannedBrowserProfile, resolved: BrowserIntelPaths) =>
      shadowCopyProfile(profile, { paths: resolved, onError: (message) => errors.push(`stage ${profile.profileId}: ${message}`) }))
  const storeFactory = deps.openStore ?? ((resolved: BrowserIntelPaths) => new IntelligenceStore(resolved.dbPath))

  let store: IntelligenceStore | null = null
  try {
    progress('detect', 'Detecting browser installations', 0, 0)
    const detected = detect({})
    progress('detect', `Detected ${detected.length} browser installations`, detected.length, detected.length)
    empty.detected = detected
    if (detected.length === 0) {
      errors.push('No supported browser installation was found.')
      return { ...empty, finishedAt: now() }
    }

    progress('scan', 'Scanning browser profiles', 0, detected.length)
    let profiles = scan({ vendors: options.vendors })
    if (options.profileIds && options.profileIds.length > 0) {
      const wanted = new Set(options.profileIds)
      profiles = profiles.filter((profile) => wanted.has(profile.profileId))
    }
    profiles = profiles.filter((profile) => profile.state === 'ok' || profile.state === 'running')
    progress('scan', `Found ${profiles.length} scannable profiles`, profiles.length, profiles.length)
    empty.profiles = profiles
    if (profiles.length === 0) {
      errors.push('No scannable browser profile was found.')
      return { ...empty, finishedAt: now() }
    }

    store = storeFactory(paths)
    store.upsertProfiles(profiles, now())

    const staged: StagedProfile[] = []
    progress('stage', 'Copying locked databases into the staging sandbox', 0, profiles.length)
    for (const [index, profile] of profiles.entries()) {
      try {
        const result = await stage(profile, paths)
        staged.push(result)
        store.recordProfileStage(profile.profileId, now())
      } catch (error) {
        errors.push(`stage ${profile.profileId}: ${errorMessage(error)}`)
      }
      progress('stage', `Staged ${index + 1}/${profiles.length}`, index + 1, profiles.length)
    }
    empty.staged = staged
    if (staged.length === 0) {
      errors.push('No profile could be staged; the pipeline stopped before Hindsight.')
      return { ...empty, finishedAt: now() }
    }

    if (options.skipHindsight !== true) {
      // A profile with no readable store (Safari, or a root that only has
      // Crashpad files) would otherwise spawn the forensic engine for nothing.
      // The skip is not an error: the profile is reported with every store in
      // `missing`, which is the structured signal the UI renders.
      const runnable = staged.filter((entry) => entry.files.length > 0)
      if (runnable.length > 0) {
        progress('hindsight', 'Running the forensic engine over staged profiles', 0, runnable.length)
        const bridge = deps.runHindsight
          ? null
          : new HindsightBridge({ store, runner: new HindsightRunner(), outputDir: paths.intelligenceDir, now })
        const outcome = bridge
          ? await bridge.runForStaged(runnable)
          : await deps.runHindsight!(runnable, paths)
        empty.hindsight = outcome.runs
        empty.ingested = outcome.ingests
        errors.push(...outcome.errors)
        progress('ingest', `Ingested ${outcome.ingests.length} profile outputs`, outcome.ingests.length, runnable.length)
      }
    }

    if (options.skipUnfurl !== true) {
      progress('unfurl', 'Unfurling URLs', 0, store.countPendingUrls())
      const runner = options.runUnfurl ?? deps.runUnfurl ?? runUnfurlBatches
      const outcome: UnfurlBatchOutcome = await runner({ dbPath: paths.dbPath, store, batchSize: 100, batchDelayMs: 150 })
      progress('unfurl', `Unfurled ${outcome.processed} URLs`, outcome.processed, outcome.processed)
    }

    if (options.skipInsights !== true) {
      progress('aggregate', 'Aggregating timeline rollups', 0, 0)
      const rollups: TimelineRollupResult = store.rebuildTimeline(now())
      empty.rollups = rollups
      progress('synthesize', 'Synthesizing the cognitive profile', 0, 1)
      const synthesis: SynthesisResult = await synthesizeSlots({ store, now: () => now() })
      empty.synthesis = synthesis
      errors.push(...synthesis.errors)
      writeCognitiveProfileCache(store, paths)
    }

    const stats = store.readStats(paths.dbPath)
    recordBrowserIntelRun(
      {
        profiles: profiles.length,
        visits: stats.visits,
        urls: stats.urls,
        slots: stats.slots,
        errors: errors.length,
      },
      paths.configDir,
      now(),
    )
    if (errors.length > 0) recordBrowserIntelError(errors[0] ?? null, paths.configDir)
    return { ...empty, finishedAt: now() }
  } catch (error) {
    errors.push(errorMessage(error))
    recordBrowserIntelError(errorMessage(error), paths.configDir)
    return { ...empty, errors, finishedAt: now() }
  } finally {
    store?.close()
  }
}

/** Convenience wrapper reading the persisted consent switch. */
export async function runIntelligencePipelineIfConsented(
  options: Omit<PipelineOptions, 'consent'> & { configDir?: string },
  deps: PipelineDeps = {},
): Promise<PipelineResult | null> {
  const state = readBrowserIntelState(options.configDir)
  if (!state.consent) return null
  return runIntelligencePipeline({ ...options, consent: true }, deps)
}