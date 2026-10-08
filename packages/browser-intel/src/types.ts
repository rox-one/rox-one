/**
 * Browser Intelligence Pipeline — shared contract.
 *
 * Frozen interface consumed by acquisition, the Hindsight bridge, the unfurl
 * worker and the insight engine. Every module in `packages/browser-intel`
 * imports its record shapes from here so the pipeline stages stay independently
 * testable and the on-disk schema never drifts from the TypeScript view.
 *
 * Privacy: discovery and staging are read-only against the browser profile.
 * Nothing in this module reads cookie or credential stores; cookie files are
 * staged only to preserve fidelity for the forensic engine and are never
 * parsed by ROX code.
 */

import type { spawn } from 'node:child_process'

/** Chromium-family, Firefox-family or Safari (Safari is inventory-only). */
export type BrowserFamily = 'chromium' | 'firefox' | 'safari'

/**
 * Vendor identity resolved from the profile root. Every vendor listed in the
 * product requirement (Chrome, Edge, Brave, Arc, Firefox, Opera, Yandex) has a
 * stable id here, plus the additional Chromium roots the shared discovery
 * module already knows about (Vivaldi, Zen, Chromium, Canary/Beta/Dev rings).
 */
export const BROWSER_VENDOR_IDS = [
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'chromium',
  'edge',
  'edge-beta',
  'edge-dev',
  'brave',
  'arc',
  'vivaldi',
  'opera',
  'opera-gx',
  'yandex',
  'yandex-enterprise',
  'zen',
  'firefox',
  'firefox-nightly',
  'firefox-developer-edition',
  'safari',
  'unknown',
] as const

export type BrowserVendorId = (typeof BROWSER_VENDOR_IDS)[number]

/** Profile lifecycle state, mirrored from the shared discovery module. */
export type ProfileState = 'ok' | 'locked' | 'corrupt' | 'running' | 'unsupported'

/**
 * A browser installation found on this machine.
 *
 * `rootPath` is the vendor data root (the directory that contains `Local State`
 * and the profile folders); `executablePath` is best-effort and may be null
 * when the application is installed in a non-default location.
 */
export interface DetectedBrowser {
  vendor: BrowserVendorId
  family: BrowserFamily
  displayName: string
  platform: NodeJS.Platform
  rootPath: string
  executablePath: string | null
  /** Highest plausible version read from the install layout, when available. */
  version: string | null
}

/** Per-profile store locations that the pipeline may stage. */
export interface ProfileStorePaths {
  /** Chromium `History` / Firefox `places.sqlite` (visits + bookmarks). */
  history: string | null
  /** Chromium `Bookmarks` (Firefox bookmarks live in places.sqlite). */
  bookmarks: string | null
  /** Firefox `places.sqlite`. */
  places: string | null
  /** Chromium `Cookies` / Firefox `cookies.sqlite` (staged, never parsed by ROX). */
  cookies: string | null
}

export const PROFILE_STORE_KINDS = ['history', 'bookmarks', 'places', 'cookies'] as const
export type ProfileStoreKind = (typeof PROFILE_STORE_KINDS)[number]

/** A browser profile folder resolved by {@link ProfileScanner}. */
export interface ScannedBrowserProfile {
  /** Stable id: `<family>:<absolute profile path>` (matches shared discovery ids). */
  profileId: string
  vendor: BrowserVendorId
  family: BrowserFamily
  displayName: string
  name: string
  path: string
  lastUsedAt: number | null
  state: ProfileState
  stores: ProfileStorePaths
}

/** One copied database file inside the staging sandbox. */
export interface StagedFile {
  kind: ProfileStoreKind
  sourcePath: string
  stagedPath: string
  bytes: number
  sha256: string
  mtimeMs: number
}

/** Result of a shadow copy: every readable store of one profile. */
export interface StagedProfile {
  profileId: string
  vendor: BrowserVendorId
  family: BrowserFamily
  stagingDir: string
  stagedAt: number
  files: StagedFile[]
  /** Store kinds that were absent or unreadable; the run continues without them. */
  missing: ProfileStoreKind[]
  totalBytes: number
  copiedInMs: number
}

export interface ShadowCopyOptions {
  /** Override the staging root (defaults to `<config>/cache/browser_staging`). */
  stagingRoot?: string
  /** Abort before copying a file larger than this (bytes). */
  maxBytesPerFile?: number
  /** Remove a pre-existing staging directory for the profile id first. */
  replace?: boolean
  now?: () => number
}

/** Hindsight invocation outcome. */
export interface HindsightRunResult {
  /** Absolute path to the produced SQLite file. */
  outputPath: string
  format: 'sqlite'
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
  /** Profiles Hindsight reported inside the staged input. */
  profilesDetected: string[]
}

export interface HindsightRunOptions {
  /** Staged profile directory (or a parent directory of several). */
  input: string
  /** Base path for `-o` (Hindsight appends `.sqlite`). */
  outputBase: string
  /** Force one browser type for every profile (`-b`). */
  browserType?: 'Chrome' | 'Edge' | 'Brave' | 'Vivaldi' | 'Firefox' | 'Tor'
  /** Optional artifact filter, e.g. `['history', 'bookmarks']`. */
  only?: string[]
  /** Hindsight log file path (`-l`). */
  logPath?: string
  logLevel?: 'debug' | 'info' | 'warning' | 'error'
  /** Skip Hindsight's own file copying: staging already isolated the databases. */
  noCopy?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  cwd?: string
}

/** Dependency bag for {@link HindsightRunner}, injectable for tests. */
export interface HindsightRunnerDeps {
  spawn?: typeof spawn
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  stat?: (path: string) => { isFile(): boolean }
}

/** Where the Hindsight executable came from. */
export interface HindsightCommand {
  command: string
  argsPrefix: string[]
  source: 'env' | 'bundled' | 'path' | 'python-module'
}

/** One visit row extracted from a Hindsight timeline. */
export interface VisitRecord {
  profileId: string
  url: string
  title: string | null
  /** Epoch milliseconds (UTC) of the visit. */
  visitTime: number
  transitionType: string | null
  /** Milliseconds; `null` when the source database recorded no duration. */
  visitDuration: number | null
  visitSource: string | null
  visitCount: number | null
  typedCount: number | null
  isBookmark: boolean
  searchQuery: string | null
}

/** One bookmark row extracted from a Hindsight timeline. */
export interface BookmarkRecord {
  profileId: string
  url: string
  title: string | null
  addedAt: number | null
}

/** Everything ingested from one Hindsight SQLite output. */
export interface HindsightIngestResult {
  profileId: string | null
  visits: number
  bookmarks: number
  urlsEnqueued: number
  skipped: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Unfurl
// ---------------------------------------------------------------------------

export interface UnfurlNode {
  id: string
  /** dfir-unfurl compatible data type, e.g. `url`, `url.query`, `base64`, `timestamp`. */
  dataType: string
  key: string | null
  value: string
  label: string
  hover: string | null
  parentId: string | null
  /** Decoder that produced the node (`base64`, `hex`, `protobuf`, `timestamp`, …). */
  decoder: string
}

export interface UnfurlEdge {
  id: string
  source: string
  target: string
  label: string | null
  decoder: string
}

/** Cytoscape-ready directed graph. */
export interface UnfurlGraph {
  nodes: UnfurlNode[]
  edges: UnfurlEdge[]
}

export interface UnfurlTimestamp {
  /** Raw token that was decoded. */
  raw: string
  /** Decoder family: `unix-seconds`, `unix-millis`, `unix-micros`, `webkit-micros`, `iso8601`, `moz-prtime`, … */
  kind: string
  /** Epoch milliseconds, UTC. */
  epochMs: number
  /** ISO-8601 rendering of {@link epochMs}. */
  iso: string
  nodeId: string | null
}

export interface UnfurlIdentifier {
  kind: string
  value: string
  nodeId: string | null
}

export interface UnfurlResult {
  urlId: number
  url: string
  normalizedUrl: string
  graph: UnfurlGraph
  tokens: string[]
  timestamps: UnfurlTimestamp[]
  identifiers: UnfurlIdentifier[]
  /** Maximum graph depth reached. */
  depth: number
  /** Wall-clock CPU cost of decoding this URL. */
  cpuMs: number
  /** True when a decoder hit its expansion limit. */
  truncated: boolean
  error: string | null
}

export interface UnfurlWorkerOptions {
  /** Chunk size for `dim_urls WHERE unfurl_status='pending'` (default 100). */
  batchSize?: number
  /** Delay between batches to hold CPU below the throttling budget (default 150ms). */
  batchDelayMs?: number
  /** Delay between individual URLs inside a batch. */
  perUrlDelayMs?: number
  /** Stop after this many batches (tests / bounded runs). */
  maxBatches?: number
  /** Abort the loop. */
  signal?: AbortSignal
  onProgress?: (progress: UnfurlProgress) => void
}

export interface UnfurlProgress {
  batches: number
  processed: number
  failed: number
  pendingRemaining: number
  lastBatchMs: number
  cpuMsTotal: number
  /** Effective sleep applied after the last batch (floor + adaptive CPU throttle). */
  throttleMs?: number
}

export interface UnfurlBatchOutcome {
  batches: number
  processed: number
  failed: number
  pendingRemaining: number
  cpuMsTotal: number
}

/** Message protocol between the main process and the unfurl Worker Thread. */
export type UnfurlWorkerMessage =
  | { type: 'start'; dbPath: string; options?: UnfurlWorkerOptions }
  | { type: 'abort' }
  | { type: 'progress'; progress: UnfurlProgress }
  | { type: 'done'; outcome: UnfurlBatchOutcome }
  | { type: 'error'; message: string }

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface TimelineBucket {
  /** `YYYY-MM-DD`, `YYYY-MM` or `YYYY` depending on the table. */
  period: string
  visits: number
  uniqueUrls: number
  uniqueDomains: number
  bookmarks: number
  searches: number
  totalDurationMs: number
  topDomain: string | null
}

export interface DomainCount {
  domain: string
  visits: number
  bookmarkCount: number
}

export interface TimelineRollupResult {
  daily: number
  monthly: number
  yearly: number
}

/** Canonical semantic slots written into `user_profile_slots`. */
export const PROFILE_SLOT_IDS = [
  'tech_stack',
  'pain_points_acute',
  'communication_archetype',
  'humor_slots',
  'steer_policy',
] as const

export type ProfileSlotId = (typeof PROFILE_SLOT_IDS)[number]

export interface ProfileSlotRecord {
  slot: string
  value: unknown
  confidence: number
  evidence: unknown
  updatedAt: number
  version: number
  /** Model that produced the slot (`synthesis` runs may be replayed per model). */
  model: string | null
}

/** Aggregated metrics handed to the Q&A synthesis prompt. */
export interface InsightMetrics {
  generatedAt: number
  windowDays: number
  totalVisits: number
  totalUrls: number
  totalDomains: number
  totalBookmarks: number
  totalSearches: number
  totalDurationMs: number
  activeDays: number
  firstVisitAt: number | null
  lastVisitAt: number | null
  hourlyHistogram: number[]
  weekdayHistogram: number[]
  topDomains: DomainCount[]
  topSearches: Array<{ query: string; count: number }>
  topBookmarks: Array<{ url: string; title: string | null; visits: number }>
  daily: TimelineBucket[]
  monthly: TimelineBucket[]
  candidates: SlotCandidate[]
}

/** Deterministic slot candidate derived from metrics before any model runs. */
export interface SlotCandidate {
  slot: string
  value: unknown
  confidence: number
  evidence: string[]
}

export interface SynthesisRequest {
  metrics: InsightMetrics
  /** Previous slots are supplied so the model can refine rather than restart. */
  previous?: ProfileSlotRecord[]
}

export interface SynthesisResult {
  slots: ProfileSlotRecord[]
  model: string | null
  /** True when no model was available and deterministic candidates were stored. */
  degraded: boolean
  prompt: string
  raw: string | null
  errors: string[]
}

/** Model callback injected by the host (no network code lives in this package). */
export type SynthesisCompletion = (input: { prompt: string; system: string }) => Promise<string>

export interface CognitiveProfileBlock {
  /** Full `<user_cognitive_profile>…</user_cognitive_profile>` block, or ''. */
  block: string
  slots: ProfileSlotRecord[]
  tokensEstimate: number
}

export interface CognitiveProfileOptions {
  /** Hard character budget for the block (default 6000). */
  maxChars?: number
  /** Only emit slots at or above this confidence. */
  minConfidence?: number
  now?: number
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'detect'
  | 'scan'
  | 'stage'
  | 'hindsight'
  | 'ingest'
  | 'unfurl'
  | 'aggregate'
  | 'synthesize'

export interface PipelineProgress {
  stage: PipelineStage
  message: string
  current: number
  total: number
  startedAt: number
}

export interface PipelineResult {
  detected: DetectedBrowser[]
  profiles: ScannedBrowserProfile[]
  staged: StagedProfile[]
  hindsight: HindsightRunResult[]
  ingested: HindsightIngestResult[]
  rollups: TimelineRollupResult | null
  synthesis: SynthesisResult | null
  errors: string[]
  startedAt: number
  finishedAt: number
}

export interface PipelineOptions {
  /** Persisted opt-in. The pipeline refuses to run unsafe stages without it. */
  consent: boolean
  /** Restrict the run to these profile ids (defaults to every scannable profile). */
  profileIds?: string[]
  /** Browsers to include; defaults to every detected vendor. */
  vendors?: BrowserVendorId[]
  /** Absolute config dir override (defaults to `resolveConfigDir()`). */
  configDir?: string
  /** Skip the Hindsight stage (unfurl-only runs, tests). */
  skipHindsight?: boolean
  /** Skip the unfurl worker (Hindsight-only runs, tests). */
  skipUnfurl?: boolean
  /** Skip rollups + synthesis. */
  skipInsights?: boolean
  runUnfurl?: (options: UnfurlWorkerOptions & { dbPath: string }) => Promise<UnfurlBatchOutcome>
  signal?: AbortSignal
  onProgress?: (progress: PipelineProgress) => void
  now?: () => number
}

/** Pipeline statistics surfaced to the UI. */
export interface IntelligenceStats {
  profiles: number
  profilesByVendor: Array<{ vendor: string; count: number }>
  urls: number
  urlsPending: number
  urlsUnfurled: number
  urlsFailed: number
  visits: number
  bookmarks: number
  searches: number
  firstVisitAt: number | null
  lastVisitAt: number | null
  unfurlDetails: number
  slots: number
  dbBytes: number | null
  lastIngestAt: number | null
  lastUnfurlAt: number | null
}

/** Persisted consent/state file (`<config>/browser-intel.json`). */
export interface BrowserIntelState {
  consent: boolean
  consentAt: number | null
  lastRunAt: number | null
  lastResult: {
    profiles: number
    visits: number
    urls: number
    slots: number
    errors: number
  } | null
  error: string | null
  revision: number
}