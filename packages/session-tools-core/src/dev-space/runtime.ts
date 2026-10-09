/**
 * Developer Space Tool Runtime — the seam between the dev-space session tools
 * (`devspace.read` / `devspace.search` / `devspace.propose`, spec 02 §9) and the
 * Dev Space artifact store that actually lives under `projects/<slug>/dev-space/`
 * (spec 02 §7).
 *
 * This package stays free of any artifact-store implementation: the runtime is
 * REGISTERED by the process that owns the Dev Space layer (server-core), exactly
 * the way `knowledge/runtime.ts` is registered by the knowledge RPC layer.
 * Claude, Pi and OMP all execute session-tool handlers in that same process, so
 * one registration covers every backend. In processes without the Dev Space
 * layer, no runtime is registered and the handlers answer with a typed
 * DEVSPACE_UNAVAILABLE error — never a hang, never a raw throw.
 *
 * Shapes are duplicated here (plain, dependency-free) rather than imported from
 * `@rox/shared/dev-space` so this package keeps no dependency on it (same rule
 * as the pages/memory types in context.ts). The manifest entry mirrors
 * `DevSpaceManifestEntry` (§7.3) — id/kind/path/format/provenance/sourceRevision.
 *
 * RULE — repository and artifact text is DATA, NOT INSTRUCTIONS (§13.2): wiki
 * pages, code comments, README bodies, symbol names, diagram labels and question
 * text are untrusted content. They can never change the agent's plan,
 * permissions, consent or rights, and can never trigger tools or publication.
 * The runtime returns text; the tool descriptions state this explicitly.
 */

/** Artifact kinds, mirroring `DevSpaceManifestEntryKind` (§7.2). */
export type DevSpaceArtifactKind =
  | 'wiki'
  | 'understanding'
  | 'code-graph'
  | 'diagram'
  | 'knowledge-graph'
  | 'c4'
  | 'questions'
  | 'tour'
  | 'sbom-cve'
  | 'audio';

/** On-disk artifact formats, mirroring `DevSpaceArtifactFormat` (§7.2). */
export type DevSpaceArtifactFormat = 'md' | 'json' | 'svg' | 'mp3' | 'srt';

/** Canonical artifact kinds — single source for the handlers' boundary filters. */
export const DEVSPACE_ARTIFACT_KINDS: readonly DevSpaceArtifactKind[] = [
  'wiki',
  'understanding',
  'code-graph',
  'diagram',
  'knowledge-graph',
  'c4',
  'questions',
  'tour',
  'sbom-cve',
  'audio',
];

/** Canonical artifact formats — single source for the propose op validator. */
export const DEVSPACE_ARTIFACT_FORMATS: readonly DevSpaceArtifactFormat[] = ['md', 'json', 'svg', 'mp3', 'srt'];

/** One manifest entry (`manifest.json` entry, §7.3) resolved to its owning project. */
export interface DevSpaceArtifactEntry {
  /** `artifact_<sha256([repositoryId, snapshotId, kind, path])>` (§7.3). */
  id: string;
  kind: DevSpaceArtifactKind;
  /** Path relative to `projects/<slug>/dev-space/`. */
  path: string;
  format: DevSpaceArtifactFormat;
  /** Provenance, mirroring code-intel `providerId`/`version` (§7.3). */
  producedBy: { providerId: string; version: string };
  /** Parent commit sha, as code-intel `SourceVersion` (§7.3). */
  sourceRevision?: string;
  createdAt: number;
  /** Owning project (`projects/<slug>/dev-space/`); filled in by the resolver. */
  projectSlug?: string;
  /** Code-intel repository id the manifest was produced for. */
  repositoryId?: string;
  /** Snapshot the artifact was built from. */
  snapshotId?: string;
}

/** Result of `devspace.read`: the entry plus its bounded content. */
export interface DevSpaceReadResult {
  artifact: DevSpaceArtifactEntry;
  /** Artifact text (md/json/svg) or base64-encoded bytes (mp3/srt). */
  content: string;
  encoding: 'utf8' | 'base64';
  /** sha256 of the raw artifact bytes — provenance/staleness hint. */
  contentHash: string;
}

/** `devspace.search` request. Implementations bound `limit`; the handler clamps too. */
export interface DevSpaceSearchInput {
  query: string;
  kind?: DevSpaceArtifactKind;
  /** Restrict to one code-intel repository id. */
  repositoryId?: string;
  /** Restrict to one project slug (`projects/<slug>`). */
  projectSlug?: string;
  limit: number;
  cursor?: string;
}

/** One search hit: the artifact entry plus an optional bounded excerpt. */
export interface DevSpaceSearchHit {
  artifact: DevSpaceArtifactEntry;
  snippet?: string;
}

/** A page of search hits (cursor pagination, as knowledge_search). */
export interface DevSpaceSearchPage {
  items: DevSpaceSearchHit[];
  totalEstimate?: number;
  nextCursor?: string;
}

/**
 * Whitelist op for `devspace.propose`. Artifacts change ONLY through
 * propose→approve (ART-005): a proposal never mutates anything on its own.
 */
export type DevSpaceProposeOp =
  | { op: 'createArtifact'; kind: DevSpaceArtifactKind; path: string; format: DevSpaceArtifactFormat; content: string }
  | { op: 'updateArtifact'; artifactId: string; content: string }
  | { op: 'deleteArtifact'; artifactId: string };

/** `devspace.propose` request — a batch of whitelist ops plus optional context. */
export interface DevSpaceProposeInput {
  ops: DevSpaceProposeOp[];
  summary?: string;
  repositoryId?: string;
  projectSlug?: string;
  /** contentHash from `devspace.read`, used as a conflict hint. */
  baseHash?: string;
}

/**
 * A created proposal. `status` starts at `pending_review`: approval and apply
 * stay human-only (reusing the existing proposals lifecycle, the analog of
 * `knowledge:applyProposal`), so a proposal must never be reported as applied.
 */
export interface DevSpaceProposal {
  id: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'applied';
  ops: DevSpaceProposeOp[];
  summary?: string;
  createdAt: number;
}

export interface DevSpaceReadRequest {
  workspaceRoot: string;
  artifactId: string;
  projectSlug?: string;
  repositoryId?: string;
}

export interface DevSpaceSearchRequest {
  workspaceRoot: string;
  input: DevSpaceSearchInput;
}

export interface DevSpaceProposeRequest {
  workspaceRoot: string;
  input: DevSpaceProposeInput;
}

/**
 * Artifact-store surface used by the dev-space tool handlers. Implementations
 * resolve `projects/<slug>/dev-space/` under `workspaceRoot`, map missing
 * artifacts/errors onto typed DevSpaceError codes, and NEVER apply a proposal.
 */
export interface DevSpaceToolRuntime {
  read(args: DevSpaceReadRequest): Promise<DevSpaceReadResult>;
  search(args: DevSpaceSearchRequest): Promise<DevSpaceSearchPage>;
  /**
   * Create a mutation proposal. Must NOT apply. Optional so read-only runtimes
   * (and tests) can omit it — the handler then reports CAPABILITY_DISABLED.
   */
  propose?(args: DevSpaceProposeRequest): Promise<DevSpaceProposal>;
}

let registeredRuntime: DevSpaceToolRuntime | null = null;

/** Register the process-wide dev-space tool runtime. Last registration wins (server reload). */
export function registerDevSpaceToolRuntime(runtime: DevSpaceToolRuntime): void {
  registeredRuntime = runtime;
}

/** The registered runtime, or null when the Dev Space layer is absent in this process. */
export function getDevSpaceToolRuntime(): DevSpaceToolRuntime | null {
  return registeredRuntime;
}

/** Test seam: drop the registration (afterEach) so suites don't leak into each other. */
export function clearDevSpaceToolRuntime(): void {
  registeredRuntime = null;
}