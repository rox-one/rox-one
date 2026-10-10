/**
 * Developer Space domain contracts (docs/specs/2026-10-09-dev-space-and-playbooks/02-SPEC-foundations.md §4–§8).
 *
 * Records are immutable snapshots of catalog/manifest/run state. Identifiers are
 * pure functions of their inputs so the same inputs always yield the same id
 * (precedent: `code-intelligence/refs.ts`).
 */
import { createHash } from 'node:crypto'

/** Lifecycle of a catalog entry; drives the "устарело" badge (§5.6) and error surface. */
export type DevSpaceRepositoryStatus =
  | 'unbound' // запись создана, репо ещё не клонировано/не привязано
  | 'cloning' // идёт клон (git-url)
  | 'cloned' // клон готов, BIND/PREVIEW не пройден
  | 'bound' // binding есть, анализа не было
  | 'analyzing' // активный прогон (§6)
  | 'ready' // артефакты есть и актуальны
  | 'stale' // есть новый снапшот, артефакты устарели (§7)
  | 'error' // последняя операция упала (lastError)

/** Where the repository comes from: a GitHub URL (D3) or a local folder (§5.4). */
export type DevSpaceRepositoryOrigin =
  | { readonly kind: 'git-url'; readonly url: string; readonly provider: 'github'; readonly defaultBranch?: string }
  | { readonly kind: 'local-folder'; readonly path: string }

/**
 * Thin wrapper over code-intelligence `RepositoryBinding`/`RepositorySnapshot`:
 * snapshots and policies are never duplicated here (§4.2).
 */
export interface DevSpaceRepositoryRecord {
  readonly schemaVersion: 1
  /** `devrepo_<sha256([workspaceId, projectId, repositoryId])>`. */
  readonly id: string
  /** code-intel `repo_<sha256(root)>`. */
  readonly repositoryId: string
  readonly workspaceId: string
  readonly projectId: string
  readonly projectSlug: string
  /** code-intel `binding_<...>`; appears only after BIND. */
  readonly bindingId?: string
  readonly origin: DevSpaceRepositoryOrigin
  readonly displayName: string
  readonly status: DevSpaceRepositoryStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastSnapshotId?: string
  /** Rule source for "устарело" (§7): `lastSnapshotId !== lastAnalyzedSnapshotId`. */
  readonly lastAnalyzedSnapshotId?: string
  /**
   * v1.x auto-watch (O10, "закрыто" 2026-10-10): explicit per-repo consent for
   * background `git fetch` against this repository. Default false — the app
   * never touches the network for a repo the user has not opted in. Watching by
   * itself never regenerates artifacts; that is the separate `watchRegenerate` opt-in.
   */
  readonly watchEnabled?: boolean
  /** With watching on, fast-forward the working copy (`git pull --ff-only`) when the upstream moved. Default false. */
  readonly watchAutoPull?: boolean
  /**
   * v1.x auto-regeneration (В11, "закрыто" 2026-10-10): after a *successful*
   * `watchAutoPull` fast-forward, refresh the repository snapshot and run the
   * `reconcile → structural → llm → publish` pipeline. Default false. Only
   * meaningful with `watchEnabled && watchAutoPull`; the LLM phase degrades to
   * `partial` without model-connector consent, while the structural artifacts
   * are always regenerated.
   */
  readonly watchRegenerate?: boolean
  /** Watch cadence in ms (`DEV_SPACE_WATCH_MIN_INTERVAL_MS`…`DEV_SPACE_WATCH_MAX_INTERVAL_MS`); absent = 60 min. */
  readonly watchIntervalMs?: number
  /** Epoch ms of the last watch tick that inspected this repository. */
  readonly lastWatchAt?: number
  /** Upstream (`@{u}`) sha observed by the last watch tick. */
  readonly lastRemoteHead?: string
  readonly lastError?: { readonly code: string; readonly at: number }
}

/** Auto-watch cadence bounds and default (v1.x O10). The server validates every `setWatch`. */
export const DEV_SPACE_WATCH_MIN_INTERVAL_MS = 15 * 60 * 1000
export const DEV_SPACE_WATCH_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000
export const DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS = 60 * 60 * 1000

/** True when `value` is an integer inside the accepted watch interval range. */
export function isValidDevSpaceWatchInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= DEV_SPACE_WATCH_MIN_INTERVAL_MS && value <= DEV_SPACE_WATCH_MAX_INTERVAL_MS
}

/** Server-owned catalog (`dev-space-repositories.json`), read by the renderer without secrets. */
export interface DevSpaceRepositoryCatalog {
  readonly schemaVersion: 1
  readonly repositories: readonly DevSpaceRepositoryRecord[]
}

export type DevSpaceManifestEntryKind =
  | 'wiki'
  | 'understanding'
  | 'code-graph'
  | 'diagram'
  | 'knowledge-graph'
  | 'c4'
  | 'questions'
  | 'tour'
  | 'sbom-cve'
  | 'audio'

export type DevSpaceArtifactFormat = 'md' | 'json' | 'svg' | 'mp3' | 'srt'

export interface DevSpaceManifestEntry {
  /** `artifact_<sha256([repositoryId, snapshotId, kind, path])>`. */
  readonly id: string
  readonly kind: DevSpaceManifestEntryKind
  /** Path relative to `projects/<slug>/dev-space/`. */
  readonly path: string
  readonly format: DevSpaceArtifactFormat
  /** Provenance, mirroring code-intel `providerId`/`version` (§7.3). */
  readonly producedBy: { readonly providerId: string; readonly version: string }
  /** Parent commit sha, as code-intel `SourceVersion` (§7.3). */
  readonly sourceRevision?: string
  readonly createdAt: number
}

/** `manifest.json` — every artifact produced for one snapshot/run (§7.3). */
export interface DevSpaceManifest {
  readonly schemaVersion: 1
  readonly repositoryId: string
  readonly snapshotId: string
  readonly runId: string
  readonly entries: readonly DevSpaceManifestEntry[]
}

/** Per-repo egress consent (`consent.json`, §8.1); no silent egress (D6). */
export interface DevSpaceConsent {
  readonly schemaVersion: 1
  readonly repositoryId: string
  readonly items: {
    /** Calls to configured model connectors. */
    readonly modelConnectors: boolean
    /** Network access for OSV. */
    readonly cveNetwork: boolean
    /** Network access for tool updates. */
    readonly toolUpdates: boolean
  }
  readonly grantedAt: number
  readonly updatedAt: number
}

/** Analysis pipeline stages (§6.1). */
export type DevSpaceRunStage = 'reconcile' | 'structural' | 'llm' | 'publish'

/** Canonical pipeline order; the run record stores exactly this sequence (§6.1). */
export const DEV_SPACE_RUN_STAGES: readonly DevSpaceRunStage[] = ['reconcile', 'structural', 'llm', 'publish']

/** Bumped whenever the tool set/versions change, so old plans are not cached into a new one (§6.2). */
export const DEV_SPACE_PLAN_VERSION = 1

export type DevSpaceRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'partial'

/** One analysis run; id is idempotent per `(repositoryId, snapshotId, planHash)` (§6.2). */
export interface DevSpaceRun {
  readonly schemaVersion: 1
  /** `devrun_<sha256([repositoryId, snapshotId, planHash])>`. */
  readonly id: string
  readonly repositoryId: string
  readonly snapshotId: string
  readonly stages: readonly DevSpaceRunStage[]
  readonly status: DevSpaceRunStatus
  readonly progress: { readonly stage: DevSpaceRunStage; readonly done: number; readonly total: number }
  readonly startedAt: number
  readonly finishedAt?: number
  readonly error?: { readonly code: string; readonly stage: DevSpaceRunStage }
  /** Artifact ids (§7). */
  readonly artifacts?: readonly string[]
  /**
   * Stages already completed, so a resumed run (same id) re-executes only the
   * unfinished ones (§6.2). Additive to the spec record; absent means "none yet".
   */
  readonly completedStages?: readonly DevSpaceRunStage[]
}

/** Push payload of `devSpace:cloneProgress` (§5.1). */
export interface DevSpaceCloneProgress {
  readonly repositoryId: string
  readonly phase: string
  readonly receivedBytes?: number
  readonly totalBytes?: number
}

/** Push payload of `devSpace:runProgress` (§6.2). */
export interface DevSpaceRunProgress {
  readonly repositoryId: string
  readonly runId: string
  readonly stage: DevSpaceRunStage
  readonly done: number
  readonly total: number
}

// ---------------------------------------------------------------------------
// RPC request/response contracts for the `devSpace:*` channels (handler:
// packages/server-core/src/handlers/rpc/dev-space.ts).
// ---------------------------------------------------------------------------

/** `addRepository` source: a GitHub URL or an absolute local-folder path. */
export type DevSpaceRepositorySourceInput =
  | { readonly kind: 'git-url'; readonly url: string }
  | { readonly kind: 'local-folder'; readonly path: string }

export interface DevSpaceListRepositoriesInput {
  readonly workspaceId: string
  /** Optional client correlation id; also the cancellation handle for long ops. */
  readonly requestId?: string
}

export interface DevSpaceAddRepositoryInput {
  readonly workspaceId: string
  readonly requestId?: string
  readonly source: DevSpaceRepositorySourceInput
  readonly projectSlug?: string
}

/**
 * `startClone` / `refreshRepository`. `repositoryId` is the **catalog record** id
 * (`devrepo_<...>`), which is what the server's `findRecord` validates.
 */
export interface DevSpaceRepositoryRequestInput {
  readonly workspaceId: string
  readonly requestId?: string
  readonly repositoryId: string
}

export interface DevSpaceRemoveRepositoryInput {
  readonly workspaceId: string
  readonly requestId?: string
  readonly repositoryId: string
  /** Must be `true`; the server rejects removal without explicit confirmation. */
  readonly confirm: boolean
}

/**
 * `setWatch` (v1.x O10/В11): per-repository auto-watch consent. `watchEnabled`
 * is the consent flag itself; `watchAutoPull`, `watchRegenerate` and
 * `watchIntervalMs` are optional refinements kept when omitted. The server
 * validates the interval range and returns the updated catalog record.
 */
export interface DevSpaceSetWatchInput {
  readonly workspaceId: string
  readonly requestId?: string
  /** Catalog record id (`devrepo_<...>`). */
  readonly repositoryId: string
  readonly watchEnabled: boolean
  readonly watchAutoPull?: boolean
  readonly watchRegenerate?: boolean
  readonly watchIntervalMs?: number
}

/** `removeRepository` returns the id of the removed catalog record. */
export interface DevSpaceRemoveRepositoryResult {
  readonly removed: string
}

export interface DevSpaceCancelInput {
  readonly workspaceId: string
  readonly requestId: string
}

export interface DevSpaceCapabilitiesInput {
  readonly workspaceId: string
  readonly requestId?: string
}

/** `capabilities`: git availability, GitHub device-login, analysis engines. */
export interface DevSpaceCapabilities {
  readonly git: boolean
  readonly githubDeviceLogin: boolean
  readonly engines: string[]
}

export interface DevSpaceListRunsInput {
  readonly workspaceId: string
  readonly requestId?: string
  /** Omit to list runs across every catalog project. */
  readonly projectSlug?: string
}

export interface DevSpaceListRunsResult {
  readonly runs: readonly DevSpaceRun[]
}

/**
 * `startRun`: begins (or resumes) the analysis pipeline for a catalog repository.
 * `repositoryId` is the catalog record id (`devrepo_<...>`), as in the other
 * repository-scoped channels.
 */
export interface DevSpaceStartRunInput {
  readonly workspaceId: string
  readonly requestId?: string
  readonly repositoryId: string
}

/** `startRun` returns the created or reused run journal record. */
export type DevSpaceStartRunResult = DevSpaceRun

// ---------------------------------------------------------------------------
// Artifact read surface (`devSpace:listArtifacts` / `devSpace:readArtifact`).
// The manifest (§7.3) is the single source of truth; the projection below is
// secret-free (relative paths + provenance only) and never carries host paths.
// ---------------------------------------------------------------------------

/** Text formats are delivered as utf8; everything else (mp3) as base64. */
export const DEV_SPACE_TEXT_ARTIFACT_FORMATS: readonly DevSpaceArtifactFormat[] = ['md', 'json', 'svg', 'srt']

/** Byte cap for one `readArtifact` response; a longer artifact is flagged `truncated`. */
export const DEV_SPACE_READ_ARTIFACT_MAX_BYTES = 512 * 1024

/** One manifest entry projected for the renderer, with freshness folded in. */
export interface DevSpaceArtifactSummary {
  readonly id: string
  readonly kind: DevSpaceManifestEntryKind
  /** Path relative to `projects/<slug>/dev-space/`; never absolute. */
  readonly path: string
  readonly format: DevSpaceArtifactFormat
  readonly producedBy: { readonly providerId: string; readonly version: string }
  readonly sourceRevision?: string
  readonly createdAt: number
  /** True when the artifact's snapshot is not the repository's current snapshot (§7). */
  readonly stale: boolean
}

/**
 * `listArtifacts`: read the current manifest for a repository (by catalog id) or
 * a project slug. An absent manifest is an empty list, not an error — the surface
 * shows «запустите анализ».
 */
export interface DevSpaceListArtifactsInput {
  readonly workspaceId: string
  readonly requestId?: string
  /** Catalog record id (`devrepo_<...>`); resolves `projectSlug` + freshness. */
  readonly repositoryId?: string
  /** Project slug; required when `repositoryId` is absent. */
  readonly projectSlug?: string
}

export interface DevSpaceListArtifactsResult {
  readonly repositoryId?: string
  readonly projectSlug: string
  readonly snapshotId?: string
  readonly runId?: string
  /** Manifest snapshot differs from the catalog's current snapshot (§7). */
  readonly stale: boolean
  readonly artifacts: readonly DevSpaceArtifactSummary[]
}

/** `readArtifact`: resolve one manifest entry id to bounded, secret-free content. */
export interface DevSpaceReadArtifactInput {
  readonly workspaceId: string
  readonly requestId?: string
  readonly projectSlug: string
  readonly artifactId: string
}

export interface DevSpaceReadArtifactResult {
  readonly artifact: DevSpaceArtifactSummary
  /** `utf8` for text formats, `base64` for binaries; `truncated` marks a byte-cap cut. */
  readonly content: string
  readonly encoding: 'utf8' | 'base64'
  readonly truncated: boolean
  readonly byteLength: number
  /** sha256 of the returned bytes (post-truncation) for provenance. */
  readonly contentHash: string
}

// ---------------------------------------------------------------------------
// Question blocks (03-SPEC-features §3, D8) + security scan summary.
// The generator (packages/server-core/src/devspace/questions) is invoked by the
// `devSpace:generateQuestions` handler; contracts live here so the renderer sees
// the same shapes.
// ---------------------------------------------------------------------------

/** The three fixed blocks (§3.1): learning, features/improvements, security. */
export type DevSpaceQuestionBlockName = 'learn' | 'features' | 'security'

/** Exactly 10 questions per block (D8). */
export const DEV_SPACE_QUESTIONS_PER_BLOCK = 10

/**
 * Transparent «почему этот вопрос» (§3.2): which personalisation inputs and which
 * repository artifact produced the question. Each field is present only when that
 * input actually contributed.
 */
export interface DevSpaceQuestionWhy {
  /** Onboarding role/profile (D1, `EnvironmentPrefs.role`). */
  readonly profile?: string
  /** Repository context: status, snapshot, size. */
  readonly repo?: string
  /** Working signals: uncommitted working copy, CI state. */
  readonly signals?: string
}

/** Link to the artifact a question is generated from (§3.1: symbols/wiki/learning/sbom/...). */
export interface DevSpaceQuestionSource {
  readonly kind: DevSpaceManifestEntryKind
  /** Template topic ref, e.g. `symbols`, `repo-wiki`, `source-graph`, `sbom`, `cve`. */
  readonly ref: string
}

export interface DevSpaceQuestion {
  readonly id: string
  readonly block: DevSpaceQuestionBlockName
  readonly text: string
  readonly why: DevSpaceQuestionWhy
  readonly source: DevSpaceQuestionSource
}

export interface DevSpaceQuestionBlock {
  readonly block: DevSpaceQuestionBlockName
  readonly title: string
  readonly questions: readonly DevSpaceQuestion[]
}

/** Honest outcome of the SBOM (syft) and CVE (OSV) half of block 3 (§3.4). */
export interface DevSpaceSecuritySummary {
  readonly sbom: {
    readonly status: 'ok' | 'unavailable'
    readonly packageCount: number
    readonly reason?: string
  }
  readonly cve: {
    /** `ok` when OSV answered; `skipped` under missing consent/tool; `error` on a network fault. */
    readonly status: 'ok' | 'skipped' | 'error'
    readonly vulnerabilityCount: number
    readonly reason?: string
  }
  /** Machine-readable degradation reasons (e.g. `syft-unavailable`, `cve-consent-denied`). */
  readonly reasons: readonly string[]
}

export interface DevSpaceGenerateQuestionsInput {
  readonly workspaceId: string
  readonly requestId?: string
  /** Catalog record id (`devrepo_<...>`). */
  readonly repositoryId: string
}

/**
 * `generateQuestions` result. A missing `modelConnectors` consent yields
 * `status: 'denied'` with a reason and no blocks — the generator never runs
 * without consent (no silent egress).
 */
export interface DevSpaceGenerateQuestionsResult {
  readonly repositoryId: string
  readonly projectSlug: string
  readonly snapshotId: string | null
  readonly status: 'ok' | 'partial' | 'denied'
  readonly generatedAt: number
  readonly blocks: readonly DevSpaceQuestionBlock[]
  readonly security: DevSpaceSecuritySummary
  /** Manifest entries written or replaced by this call (questions + security). */
  readonly artifacts: readonly DevSpaceArtifactSummary[]
  readonly reasons: readonly string[]
}

/** sha256 of the JSON-encoded input; shared by all three id formulas below. */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Catalog entry id; stable for a given workspace/project/repository triple. */
export function devSpaceRepositoryId(workspaceId: string, projectId: string, repositoryId: string): string {
  return `devrepo_${digest([workspaceId, projectId, repositoryId])}`
}

/** Manifest artifact id; stable for a given snapshot/kind/path. */
export function devSpaceManifestEntryId(
  repositoryId: string,
  snapshotId: string,
  kind: DevSpaceManifestEntryKind,
  path: string,
): string {
  return `artifact_${digest([repositoryId, snapshotId, kind, path])}`
}

/** Run id; deterministic across retries so the same snapshot/plan is a cache hit. */
export function devSpaceRunId(repositoryId: string, snapshotId: string, planHash: string): string {
  return `devrun_${digest([repositoryId, snapshotId, planHash])}`
}

/**
 * Manifest run id for the on-demand question/security artifacts (D8). The caller
 * reuses the analysis run's id when a manifest already covers the same snapshot
 * so the manifest is extended, not reset; otherwise this deterministic id is the
 * fallback (idempotent across reruns of the same snapshot).
 */
export function devSpaceQuestionsRunId(repositoryId: string, snapshotId: string): string {
  return `devrun_${digest([repositoryId, snapshotId, 'questions'])}`
}

/**
 * Plan hash for the current pipeline definition: a run shares a cache entry only
 * while both its snapshot and its plan (stage set + versions) are unchanged (§6.2).
 */
export function devSpacePlanHash(stages: readonly DevSpaceRunStage[] = DEV_SPACE_RUN_STAGES): string {
  return digest([DEV_SPACE_PLAN_VERSION, stages])
}