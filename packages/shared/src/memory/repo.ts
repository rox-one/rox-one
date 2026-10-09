/**
 * Memory repository + dream — wire-safe DTOs shared by server and renderer.
 *
 * Spec: docs/plans/2026-10-09-memory-repository-and-dreaming.md (§7).
 * These are transport types only: the repository is a deterministic projection
 * of the existing memory stores (LessonStore / MemoryFileStore), and nothing in
 * this file reads or writes state. `packages/server-core/src/memory/repo/*`
 * produces them; `handlers/rpc/memory-repo.ts` serves them over RPC.
 *
 * No telemetry fields ever appear here — usage counters live in the JSONL
 * stores and must never be committed to the repository.
 */

/** One materialized memory bank (spec §5). `main` is the global/personal bank. */
export interface MemoryRepoBankInfo {
  /** `main` | `main#<ownerKey8>` | `ws:<workspaceId>` | `ws:<workspaceId>#<ownerKey8>`. */
  id: string
  scope: 'main' | 'workspace'
  label: string
  repoPath: string
  isMain: boolean
}

/** Freshness + dream summary of one bank's repository. */
export interface MemoryRepoStatus {
  bankId: string
  scope: 'main' | 'workspace'
  repoPath: string
  /** `snapshots` when the system `git` binary is unavailable (spec §6 fallback). */
  mode: 'git' | 'snapshots'
  head: { sha: string; message: string; ts: string } | null
  lastMaterializeAt: string | null
  dirty: boolean
  /** Repository-relative paths edited by a human and not yet overwritten. */
  editedFiles: string[]
  /** True when the repository lives inside a foreign git work tree (override). */
  foreignTree: boolean
  pendingImportCount: number
  dream: {
    lastRunAt: string | null
    nextRunAt: string | null
    intervalHours: number
    model?: string
    costTodayUsd: number
    costIsEstimate: boolean
  }
}

/** One node of the repository file tree (flat list with `depth`). */
export interface MemoryRepoTreeNode {
  path: string
  name: string
  type: 'file' | 'dir'
  depth: number
  badges?: Array<'edited' | 'dreamed'>
  sizeBytes?: number
}

/** A single repository file's text content. */
export interface MemoryRepoFile {
  path: string
  content: string
  truncated: boolean
  edited: boolean
  lessonId?: string
}

/** `--stat`-style summary of one changed file in a commit. */
export interface MemoryRepoCommitFile {
  path: string
  op: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
}

/** One commit (or snapshot, in `snapshots` mode). */
export interface MemoryRepoCommit {
  sha: string
  parent: string | null
  message: string
  ts: string
  files: MemoryRepoCommitFile[]
  stats: { added: number; modified: number; deleted: number }
}

/** Knowledge graph projection of a bank (lessons/topics/context/sessions/notes). */
export interface MemoryRepoGraph {
  nodes: Array<{
    id: string
    kind: 'lesson' | 'topic' | 'context' | 'session' | 'note' | 'file'
    label: string
    path?: string
  }>
  edges: Array<{ from: string; to: string; kind: 'cluster' | 'provenance' | 'wikilink' }>
}

/** One dream (memory build) run. */
export interface MemoryDreamRun {
  dreamId: string
  bankId: string
  startedAt: string
  endedAt: string | null
  status: 'running' | 'ok' | 'error' | 'skipped'
  model?: string
  costUsd: number
  costIsEstimate: boolean
  error?: string
}

/** One line of the append-only dream journal (`dream-log.jsonl`). */
export interface MemoryDreamEvent {
  ts: string
  dreamId: string
  bankId: string
  kind: 'start' | 'distill' | 'notes' | 'consolidate' | 'decay' | 'commit' | 'cost' | 'end' | 'error'
  message: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

/** Dream state of one bank. */
export interface MemoryDreamStatus {
  bankId: string
  running: boolean
  lastRun: MemoryDreamRun | null
  nextRunAt: string | null
  intervalHours: number
  model?: string
  costTodayUsd: number
  costIsEstimate: boolean
  pendingNoteIds: string[]
}

/** One edit derived from a human-modified repository file (spec §9 import). */
export interface MemoryRepoImportEdit {
  path: string
  kind: 'update' | 'add' | 'delete'
  lessonId?: string
  rule?: string
  diff?: string
  conflict?: 'rule-changed' | 'unknown-id' | 'deleted'
  proposalId?: string
}

/** Preview of a repository import (spec §9). */
export interface MemoryRepoImportPreview {
  bankId: string
  edits: MemoryRepoImportEdit[]
  conflicts: number
}

/** Result of exporting a bank as a zip archive. */
export interface MemoryRepoExportResult {
  path: string
  bytes: number
}