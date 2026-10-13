/**
 * Persist converted foreign chats as Rox session.jsonl.
 * MUST NOT write a DSH store or compressed DSH frames. Avoids storage.ts so tests
 * do not pull node-only workspace deps (zod).
 *
 * Runs on the Electron main process (ADR-0025): the registry and scan cache are
 * parsed once per run, the registry is written once per batch, "already imported"
 * is decided from the registry before the source is parsed, and existing session
 * bodies are never read for dedupe (only their first-line headers, once per run).
 */

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAllowedForeignSourcePath, splitForeignSourceRef } from './import-home.ts'
import { convertForeignSource, inspectForeignSource, MAX_FOREIGN_EXPORT_BYTES } from './import-convert.ts'
import {
  createScannedForeignSourceLookup,
  loadForeignImportRegistry,
  loadForeignImportScanCache,
  saveForeignImportRegistry,
} from './import-registry.ts'
import { generateUniqueSessionId } from './slug-generator.ts'
import { isValidSessionId, sanitizeSessionId } from './validation.ts'
import type {
  ConvertedForeignMessage,
  ConvertedForeignSession,
  ForeignImportMode,
  ForeignIndexEntry,
  ForeignPersistResult,
  ForeignRegistryRecord,
  ForeignSessionKind,
} from './import-types.ts'

export const FOREIGN_PERSIST_BATCH_SIZE = 25

export interface PersistForeignOptions {
  workspaceRoot: string
  sourcePath: string
  kind?: ForeignSessionKind
  mode?: ForeignImportMode
  homeDir?: string
}

/** Disk and parse operations of a persist run; injectable so callers can count them. */
export interface ForeignPersistIo {
  loadRegistry(workspaceRoot: string): Record<string, ForeignRegistryRecord>
  saveRegistry(workspaceRoot: string, entries: Record<string, ForeignRegistryRecord>): void
  loadScanCache(workspaceRoot: string): ForeignIndexEntry[]
  convert(sourcePath: string, kind: ForeignSessionKind): ConvertedForeignSession
  /** First line of a session.jsonl, or null when it is missing. */
  readSessionHeader(file: string): string | null
  /** Whole session.jsonl, or null when it is missing. */
  readSessionFile(file: string): string | null
}

export const defaultForeignPersistIo: ForeignPersistIo = {
  loadRegistry: loadForeignImportRegistry,
  saveRegistry: saveForeignImportRegistry,
  loadScanCache: loadForeignImportScanCache,
  convert: convertForeignSource,
  readSessionHeader: readFirstLine,
  readSessionFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
}

export interface PersistForeignSessionsOptions {
  /** Checked between batches; items of an aborted run's later batches are not processed or returned. */
  signal?: AbortSignal
  batchSize?: number
  /** Runs after each batch's registry write, before the next batch starts. */
  onBatch?: (results: ForeignPersistResult[]) => void | Promise<void>
  /** Registry the caller already parsed for this run. Not mutated. */
  registry?: Record<string, ForeignRegistryRecord>
  /** Scan-cache entries the caller already holds for this run. */
  scanEntries?: readonly ForeignIndexEntry[]
  io?: Partial<ForeignPersistIo>
}

interface RoxSessionFile {
  id: string
  name?: string
  workingDirectory?: string
  foreignSource?: { sourcePath: string; kind: ForeignSessionKind; contentHash: string; importedAt: number }
  messages: Array<{ id: string; type: 'user' | 'assistant'; content: string; timestamp?: number }>
}

interface PersistedSource {
  sessionId: string
  foreignSource?: RoxSessionFile['foreignSource']
  messageCount: number
}

interface PersistRun {
  workspaceRoot: string
  homeDir?: string
  io: ForeignPersistIo
  preloadedRegistry?: Record<string, ForeignRegistryRecord>
  preloadedScanEntries?: readonly ForeignIndexEntry[]
  registry?: Record<string, ForeignRegistryRecord>
  registryDirty: boolean
  findScanned?: (sourcePath: string) => ForeignIndexEntry | undefined
  sessionIds?: Set<string>
  persistedSources?: Map<string, PersistedSource>
}

function sessionsDir(workspaceRoot: string): string {
  return join(workspaceRoot, 'sessions')
}

function sessionFile(workspaceRoot: string, sessionId: string): string {
  return join(sessionsDir(workspaceRoot), sanitizeSessionId(sessionId), 'session.jsonl')
}

function existingIds(workspaceRoot: string): string[] {
  const dir = sessionsDir(workspaceRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function readFirstLine(file: string): string | null {
  if (!existsSync(file)) return null
  const fd = openSync(file, 'r')
  try {
    const chunks: Buffer[] = []
    const buffer = Buffer.alloc(16 * 1024)
    let position = 0
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      const newline = buffer.subarray(0, bytesRead).indexOf(0x0a)
      if (newline >= 0) {
        chunks.push(Buffer.from(buffer.subarray(0, newline)))
        break
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      position += bytesRead
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function toMessages(sourcePath: string, messages: ConvertedForeignMessage[]): RoxSessionFile['messages'] {
  return messages.map((message, index) => ({
    id: `import-${index}-${Math.abs(hashCode(`${sourcePath}:${index}:${message.role}`))}`,
    type: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }))
}

function mergeImportedMessages(
  existing: RoxSessionFile['messages'],
  incoming: RoxSessionFile['messages'],
): RoxSessionFile['messages'] {
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const seen = new Set<string>()
  const merged = existing.flatMap((message) => {
    const updated = incomingById.get(message.id)
    if (!updated && message.id.startsWith('import-')) return []
    if (!updated) return [message]
    seen.add(message.id)
    return [updated]
  })
  for (const message of incoming) {
    if (!seen.has(message.id)) merged.push(message)
  }
  return merged
}

function fingerprint(messages: ConvertedForeignMessage[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return hash
}

function writeRoxSession(workspaceRoot: string, session: RoxSessionFile): boolean {
  const id = sanitizeSessionId(session.id)
  if (!id || !isValidSessionId(id)) return false
  const dir = join(sessionsDir(workspaceRoot), id)
  mkdirSync(join(dir, 'plans'), { recursive: true })
  mkdirSync(join(dir, 'attachments'), { recursive: true })
  const now = Date.now()
  const last = session.messages[session.messages.length - 1]
  const preview = session.messages.find((m) => m.type === 'user')?.content?.slice(0, 180)
  const header = {
    id,
    workspaceRootPath: workspaceRoot,
    name: session.name,
    createdAt: now,
    lastUsedAt: now,
    workingDirectory: workspaceRoot,
    sdkCwd: dir,
    messageCount: session.messages.length,
    lastMessageRole: last?.type,
    preview,
    foreignSource: session.foreignSource,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  }
  const file = sessionFile(workspaceRoot, id)
  const lines = [JSON.stringify(header), ...session.messages.map((m) => JSON.stringify(m))]
  const tmp = `${file}.${process.pid}.${now}.tmp`
  writeFileSync(tmp, `${lines.join('\n')}\n`)
  renameSync(tmp, file)
  return true
}

function readRoxSession(
  workspaceRoot: string,
  sessionId: string,
  io: ForeignPersistIo = defaultForeignPersistIo,
): RoxSessionFile | null {
  const id = sanitizeSessionId(sessionId)
  if (!id || !isValidSessionId(id)) return null
  const raw = io.readSessionFile(sessionFile(workspaceRoot, id))
  if (raw === null) return null
  const lines = raw.split('\n').filter(Boolean)
  if (lines.length === 0) return null
  const header = JSON.parse(lines[0]!) as {
    id: string
    name?: string
    workingDirectory?: string
    foreignSource?: RoxSessionFile['foreignSource']
  }
  const messages = lines.slice(1).map((line) => JSON.parse(line) as RoxSessionFile['messages'][number])
  return {
    id: header.id,
    name: header.name,
    workingDirectory: header.workingDirectory,
    foreignSource: header.foreignSource,
    messages,
  }
}

function openPersistRun(workspaceRoot: string, homeDir: string | undefined, options: PersistForeignSessionsOptions): PersistRun {
  return {
    workspaceRoot,
    homeDir,
    io: { ...defaultForeignPersistIo, ...options.io },
    preloadedRegistry: options.registry,
    preloadedScanEntries: options.scanEntries,
    registryDirty: false,
  }
}

function runRegistry(run: PersistRun): Record<string, ForeignRegistryRecord> {
  run.registry ??= run.preloadedRegistry ? { ...run.preloadedRegistry } : run.io.loadRegistry(run.workspaceRoot)
  return run.registry
}

function recordInRun(run: PersistRun, record: ForeignRegistryRecord): void {
  runRegistry(run)[record.sourcePath] = record
  run.registryDirty = true
}

function flushRegistry(run: PersistRun): void {
  if (!run.registryDirty || !run.registry) return
  run.io.saveRegistry(run.workspaceRoot, run.registry)
  run.registryDirty = false
}

function findScannedInRun(run: PersistRun, sourcePath: string): ForeignIndexEntry | undefined {
  run.findScanned ??= createScannedForeignSourceLookup(
    run.preloadedScanEntries ?? run.io.loadScanCache(run.workspaceRoot),
  )
  return run.findScanned(sourcePath)
}

function knownSessionIds(run: PersistRun): Set<string> {
  run.sessionIds ??= new Set(existingIds(run.workspaceRoot))
  return run.sessionIds
}

/**
 * sourcePath → persisted session for sessions the registry does not know (registry
 * lost or written before a crash). Built once per run from first-line headers.
 */
function persistedSourcesByPath(run: PersistRun): Map<string, PersistedSource> {
  if (run.persistedSources) return run.persistedSources
  const registered = new Set(Object.values(runRegistry(run)).map((record) => sanitizeSessionId(record.sessionId)))
  const sources = new Map<string, PersistedSource>()
  for (const sessionId of knownSessionIds(run)) {
    if (registered.has(sessionId) || !isValidSessionId(sessionId)) continue
    const line = run.io.readSessionHeader(sessionFile(run.workspaceRoot, sessionId))
    if (!line) continue
    try {
      const header = JSON.parse(line) as { id?: string; foreignSource?: RoxSessionFile['foreignSource']; messageCount?: number }
      const sourcePath = header.foreignSource?.sourcePath
      if (!sourcePath || sources.has(sourcePath)) continue
      sources.set(sourcePath, {
        sessionId: header.id ?? sessionId,
        foreignSource: header.foreignSource,
        messageCount: header.messageCount ?? 0,
      })
    } catch {
      // Unreadable header: not a recoverable import.
    }
  }
  run.persistedSources = sources
  return sources
}

function findExistingImport(
  run: PersistRun,
  sourcePath: string,
  kind: ForeignSessionKind,
  importedAt: number,
): ForeignRegistryRecord | undefined {
  const existingRaw = runRegistry(run)[sourcePath]
  const existingId = existingRaw ? sanitizeSessionId(existingRaw.sessionId) : ''
  if (existingRaw && existingId && isValidSessionId(existingId)) return { ...existingRaw, sessionId: existingId }
  const recovered = persistedSourcesByPath(run).get(sourcePath)
  if (!recovered) return undefined
  const record: ForeignRegistryRecord = {
    sessionId: recovered.sessionId,
    kind,
    importedAt: recovered.foreignSource?.importedAt ?? importedAt,
    sourcePath,
    contentHash: recovered.foreignSource?.contentHash,
    messageCount: recovered.messageCount,
  }
  recordInRun(run, record)
  return record
}

function persistInRun(run: PersistRun, sourcePath: string, mode: ForeignImportMode): ForeignPersistResult {
  const { workspaceRoot } = run
  if (!isAllowedForeignSourcePath(sourcePath, run.homeDir)) {
    return { sourcePath, action: 'skipped', reason: 'outside-p0-root' }
  }
  const filePath = splitForeignSourceRef(sourcePath).path
  const sourceGuard = inspectForeignSource(
    filePath,
    filePath.endsWith('.json') && !filePath.endsWith('.jsonl') ? MAX_FOREIGN_EXPORT_BYTES : undefined,
  )
  if (sourceGuard.status === 'symlink') {
    return { sourcePath, action: 'skipped', reason: 'source-symlink' }
  }
  const scanned = findScannedInRun(run, sourcePath)
  if (!scanned) {
    return { sourcePath, action: 'skipped', reason: 'not-in-scan-cache' }
  }
  const kind = scanned.kind
  const importedAt = Date.now()
  const existing = findExistingImport(run, sourcePath, kind, importedAt)
  if (existing && mode === 'skip') {
    return { sourcePath, action: 'skipped', sessionId: existing.sessionId, reason: 'already-imported' }
  }

  const converted = run.io.convert(sourcePath, kind)
  if (converted.userTurns === 0) {
    return { sourcePath, action: 'skipped', reason: 'empty', anomalies: converted.anomalies }
  }
  const storedMessages = toMessages(sourcePath, converted.messages)
  const contentHash = fingerprint(converted.messages)
  if (existing && mode === 'append' && existing.contentHash === contentHash) {
    if (existing.sourceMtimeMs !== scanned.mtimeMs) {
      recordInRun(run, { ...existing, sourceMtimeMs: scanned.mtimeMs, messageCount: converted.messages.length })
    }
    return {
      sourcePath,
      action: 'skipped',
      sessionId: existing.sessionId,
      reason: 'source-unchanged',
      anomalies: converted.anomalies,
    }
  }

  if (existing && (mode === 'append' || mode === 'force')) {
    const session = readRoxSession(workspaceRoot, existing.sessionId, run.io)
    if (session) {
      session.messages =
        mode === 'append'
          ? mergeImportedMessages(session.messages, storedMessages)
          : storedMessages
      session.name = converted.title
      session.workingDirectory = workspaceRoot
      session.foreignSource = { sourcePath, kind, contentHash, importedAt }
      if (!writeRoxSession(workspaceRoot, session)) {
        return { sourcePath, action: 'skipped', reason: 'invalid-session-id' }
      }
      recordInRun(run, {
        sessionId: session.id,
        kind,
        importedAt,
        sourcePath,
        sourceMtimeMs: scanned.mtimeMs,
        contentHash,
        messageCount: converted.messages.length,
      })
      return {
        sourcePath,
        action: mode === 'append' ? 'appended' : 'replaced',
        sessionId: session.id,
        anomalies: converted.anomalies,
      }
    }
  }

  const ids = knownSessionIds(run)
  const id = generateUniqueSessionId(ids)
  const written = writeRoxSession(workspaceRoot, {
    id,
    name: converted.title,
    workingDirectory: workspaceRoot,
    foreignSource: { sourcePath, kind, contentHash, importedAt },
    messages: storedMessages,
  })
  if (!written) {
    return { sourcePath, action: 'skipped', reason: 'invalid-session-id' }
  }
  ids.add(id)
  recordInRun(run, {
    sessionId: id,
    kind,
    importedAt,
    sourcePath,
    sourceMtimeMs: scanned.mtimeMs,
    contentHash,
    messageCount: converted.messages.length,
  })
  return { sourcePath, action: 'created', sessionId: id, anomalies: converted.anomalies }
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export async function persistForeignSession(options: PersistForeignOptions): Promise<ForeignPersistResult> {
  const run = openPersistRun(options.workspaceRoot, options.homeDir, {})
  const result = persistInRun(run, options.sourcePath, options.mode ?? 'skip')
  flushRegistry(run)
  return result
}

/**
 * Persist many sources in batches: one registry write per batch, `onBatch` after it,
 * then a yield to the event loop. A per-item failure becomes `import-failed`.
 */
export async function persistForeignSessions(
  workspaceRoot: string,
  items: Array<{ sourcePath: string; kind?: ForeignSessionKind; mode?: ForeignImportMode }>,
  mode: ForeignImportMode = 'skip',
  homeDir?: string,
  options: PersistForeignSessionsOptions = {},
): Promise<ForeignPersistResult[]> {
  const run = openPersistRun(workspaceRoot, homeDir, options)
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? FOREIGN_PERSIST_BATCH_SIZE))
  const results: ForeignPersistResult[] = []
  for (let start = 0; start < items.length; start += batchSize) {
    if (start > 0) await yieldToLoop()
    if (options.signal?.aborted) break
    const batch: ForeignPersistResult[] = []
    for (const item of items.slice(start, start + batchSize)) {
      try {
        batch.push(persistInRun(run, item.sourcePath, item.mode ?? mode))
      } catch {
        batch.push({ sourcePath: item.sourcePath, action: 'skipped', reason: 'import-failed' })
      }
    }
    flushRegistry(run)
    results.push(...batch)
    await options.onBatch?.(batch)
  }
  return results
}

export function listImportedSessionFiles(workspaceRoot: string): string[] {
  const dir = sessionsDir(workspaceRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(sessionFile(workspaceRoot, entry.name)))
    .map((entry) => sessionFile(workspaceRoot, entry.name))
}

export function readImportedSession(workspaceRoot: string, sessionId: string): RoxSessionFile | null {
  return readRoxSession(workspaceRoot, sessionId)
}
