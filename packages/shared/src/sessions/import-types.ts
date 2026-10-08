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

/**
 * Kinds listed in the source picker but without a working on-disk scanner and
 * converter. opencode keeps chats in per-project stores without a stable,
 * documented file layout we can read safely, so it is reported honestly as
 * "not supported" in the UI rather than silently contributing nothing to a
 * scan (the previous `*.db`/`*.sqlite` stub walked the roots and emitted only
 * empty rows).
 */
export const UNSUPPORTED_FOREIGN_SESSION_KINDS = ['opencode'] as const

/** True when the kind has a working scanner + converter and can be imported. */
export function isForeignSessionKindSupported(kind: ForeignSessionKind): boolean {
  return !(UNSUPPORTED_FOREIGN_SESSION_KINDS as readonly string[]).includes(kind)
}

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
  /**
   * Set when the scan could not run at all on this surface (e.g. the local
   * scan consent gate is not live). Distinguishes "nothing found" from
   * "could not look" so the UI never shows a silent empty list.
   */
  unavailable?: 'not-live'
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
