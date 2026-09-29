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
  skipReason?: 'empty'
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
}

/** Background (automatic) foreign chat import status. */
export type ForeignAutoImportState = 'idle' | 'scanning' | 'importing' | 'done' | 'error' | 'disabled'

export interface ForeignAutoImportStatus {
  workspaceId: string | null
  enabled: boolean
  state: ForeignAutoImportState
  /** Chats found in local sources (non-empty). */
  found: number
  /** Chats already present in Rox. */
  alreadyImported: number
  /** Created in the last run. */
  imported: number
  /** Appended with new turns in the last run. */
  updated: number
  /** Older (or over-limit) chats not imported automatically. */
  remaining: number
  /** Per-source counts of found chats. */
  bySource: Record<string, number>
  lastRunAt: number | null
  error?: string
}
