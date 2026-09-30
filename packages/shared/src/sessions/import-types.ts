/**
 * First-party foreign-chat import (H5 / H-04 §4).
 * Scan ≠ persist. Persist writes Rox transcripts only — never a DSH store or zstd frames.
 */

export const FOREIGN_SESSION_KINDS = [
  'grok',
  'claude',
  'codex',
  'opencode',
  'hermes',
  'chatgpt',
  'deepseek',
  'gemini',
  'qwen',
  'amp',
  'cursor',
  'openclaw',
  'omp',
  'pi',
  'kiro',
  'kimi',
  'glm',
  'z',
] as const

export type ForeignSessionKind = (typeof FOREIGN_SESSION_KINDS)[number]

export type ForeignImportMode = 'skip' | 'append' | 'force'

export interface ForeignIndexEntry {
  id: string
  kind: ForeignSessionKind
  sourcePath: string
  title?: string
  cwd?: string
  userTurns: number
  mtimeMs?: number
  skipReason?: 'empty' | 'internal'
}

export interface ConvertedForeignMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export interface ConvertedForeignSession {
  sourcePath: string
  kind: ForeignSessionKind
  title: string
  cwd?: string
  messages: ConvertedForeignMessage[]
  userTurns: number
  anomalies: string[]
}

export interface ForeignRegistryRecord {
  sessionId: string
  kind: ForeignSessionKind
  importedAt: number
  sourcePath: string
  /** Last source modification time observed when its imported snapshot was saved. */
  sourceMtimeMs?: number
  /** SHA-256 of the normalized imported message snapshot, not source-file bytes. */
  contentHash?: string
  messageCount?: number
}

export interface ForeignPersistResult {
  sourcePath: string
  action: 'created' | 'skipped' | 'appended' | 'replaced'
  sessionId?: string
  reason?: string
  anomalies?: string[]
}

export interface ForeignDiscoverResult {
  entries: ForeignIndexEntry[]
  scannedAt: number
  cachePath: string
  truncated?: boolean
  aborted?: boolean
}

/** Background (automatic) foreign chat import status. */
export type ForeignAutoImportState = 'idle' | 'scanning' | 'importing' | 'partial' | 'done' | 'error' | 'disabled'

export interface ForeignAutoImportStatus {
  workspaceId: string | null
  enabled: boolean
  state: ForeignAutoImportState
  found: number
  alreadyImported: number
  imported: number
  updated: number
  remaining: number
  bySource: Record<string, number>
  failed: number
  failureReasons: Record<string, number>
  truncated: boolean
  partialReason?: 'source-failure' | 'scan-truncated' | 'consent-revoked'
  lastRunAt: number | null
  error?: string
}
