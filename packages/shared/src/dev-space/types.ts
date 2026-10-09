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
  readonly lastError?: { readonly code: string; readonly at: number }
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
 * Plan hash for the current pipeline definition: a run shares a cache entry only
 * while both its snapshot and its plan (stage set + versions) are unchanged (§6.2).
 */
export function devSpacePlanHash(stages: readonly DevSpaceRunStage[] = DEV_SPACE_RUN_STAGES): string {
  return digest([DEV_SPACE_PLAN_VERSION, stages])
}