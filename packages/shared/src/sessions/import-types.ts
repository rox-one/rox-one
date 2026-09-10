/**
 * First-party foreign-chat import (H5 / H-04 §4).
 * Scan ≠ persist. Persist writes Rox transcripts only — never a DSH store or zstd frames.
 */

export const FOREIGN_SESSION_KINDS = ['grok', 'claude', 'codex', 'opencode', 'hermes'] as const

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
}
