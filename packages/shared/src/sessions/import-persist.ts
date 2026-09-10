/**
 * Persist converted foreign chats as Rox session.jsonl.
 * MUST NOT write a DSH store or compressed DSH frames. Avoids storage.ts so tests
 * do not pull node-only workspace deps (zod).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAllowedForeignSourcePath, isSensitiveAgentCwd } from './import-home.ts'
import { convertForeignSource } from './import-convert.ts'
import { lookupImportedSession, recordImportedSession } from './import-registry.ts'
import { generateUniqueSessionId } from './slug-generator.ts'
import { sanitizeSessionId } from './validation.ts'
import type { ForeignImportMode, ForeignPersistResult, ForeignSessionKind } from './import-types.ts'
import type { ConvertedForeignMessage } from './import-types.ts'

export interface PersistForeignOptions {
  workspaceRoot: string
  sourcePath: string
  kind: ForeignSessionKind
  mode?: ForeignImportMode
  homeDir?: string
}

interface RoxSessionFile {
  id: string
  name?: string
  workingDirectory?: string
  messages: Array<{ id: string; type: 'user' | 'assistant'; content: string; timestamp?: number }>
}

function sessionsDir(workspaceRoot: string): string {
  return join(workspaceRoot, 'sessions')
}

function sessionFile(workspaceRoot: string, sessionId: string): string {
  return join(sessionsDir(workspaceRoot), sanitizeSessionId(sessionId), 'session.jsonl')
}

function resolveAttachCwd(cwd: string | undefined, workspaceRoot: string, homeDir?: string): string {
  if (!cwd || isSensitiveAgentCwd(cwd, homeDir)) return workspaceRoot
  try {
    if (!existsSync(cwd)) return workspaceRoot
  } catch {
    return workspaceRoot
  }
  return cwd
}

function existingIds(workspaceRoot: string): string[] {
  const dir = sessionsDir(workspaceRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function toMessages(sourcePath: string, messages: ConvertedForeignMessage[]): RoxSessionFile['messages'] {
  return messages.map((message, index) => ({
    id: `import-${index}-${Math.abs(hashCode(`${sourcePath}:${index}:${message.role}`))}`,
    type: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }))
}

function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return hash
}

function writeRoxSession(workspaceRoot: string, session: RoxSessionFile): void {
  const id = sanitizeSessionId(session.id)
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
    workingDirectory: session.workingDirectory,
    sdkCwd: dir,
    messageCount: session.messages.length,
    lastMessageRole: last?.type,
    preview,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  }
  const file = sessionFile(workspaceRoot, id)
  const lines = [JSON.stringify(header), ...session.messages.map((m) => JSON.stringify(m))]
  const tmp = `${file}.${process.pid}.${now}.tmp`
  writeFileSync(tmp, `${lines.join('\n')}\n`)
  try {
    unlinkSync(file)
  } catch {
    /* first write */
  }
  renameSync(tmp, file)
}

function readRoxSession(workspaceRoot: string, sessionId: string): RoxSessionFile | null {
  const file = sessionFile(workspaceRoot, sessionId)
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  if (lines.length === 0) return null
  const header = JSON.parse(lines[0]!) as { id: string; name?: string; workingDirectory?: string }
  const messages = lines.slice(1).map((line) => JSON.parse(line) as RoxSessionFile['messages'][number])
  return {
    id: header.id,
    name: header.name,
    workingDirectory: header.workingDirectory,
    messages,
  }
}

export async function persistForeignSession(options: PersistForeignOptions): Promise<ForeignPersistResult> {
  const mode = options.mode ?? 'skip'
  if (!isAllowedForeignSourcePath(options.sourcePath, options.homeDir)) {
    return { sourcePath: options.sourcePath, action: 'skipped', reason: 'outside-p0-root' }
  }
  const converted = convertForeignSource(options.sourcePath, options.kind)
  if (converted.userTurns === 0) {
    return { sourcePath: options.sourcePath, action: 'skipped', reason: 'empty', anomalies: converted.anomalies }
  }

  const existing = lookupImportedSession(options.workspaceRoot, options.sourcePath)
  if (existing && mode === 'skip') {
    return {
      sourcePath: options.sourcePath,
      action: 'skipped',
      sessionId: existing.sessionId,
      reason: 'already-imported',
      anomalies: converted.anomalies,
    }
  }

  const attachCwd = resolveAttachCwd(converted.cwd, options.workspaceRoot, options.homeDir)
  const storedMessages = toMessages(options.sourcePath, converted.messages)

  if (existing && (mode === 'append' || mode === 'force')) {
    const session = readRoxSession(options.workspaceRoot, existing.sessionId)
    if (session) {
      session.messages = mode === 'append' ? [...session.messages, ...storedMessages] : storedMessages
      session.name = converted.title
      session.workingDirectory = attachCwd
      writeRoxSession(options.workspaceRoot, session)
      recordImportedSession(options.workspaceRoot, {
        sessionId: session.id,
        kind: options.kind,
        importedAt: Date.now(),
        sourcePath: options.sourcePath,
      })
      return {
        sourcePath: options.sourcePath,
        action: mode === 'append' ? 'appended' : 'replaced',
        sessionId: session.id,
        anomalies: converted.anomalies,
      }
    }
  }

  const id = generateUniqueSessionId(existingIds(options.workspaceRoot))
  writeRoxSession(options.workspaceRoot, {
    id,
    name: converted.title,
    workingDirectory: attachCwd,
    messages: storedMessages,
  })
  recordImportedSession(options.workspaceRoot, {
    sessionId: id,
    kind: options.kind,
    importedAt: Date.now(),
    sourcePath: options.sourcePath,
  })
  return {
    sourcePath: options.sourcePath,
    action: 'created',
    sessionId: id,
    anomalies: converted.anomalies,
  }
}

export async function persistForeignSessions(
  workspaceRoot: string,
  items: Array<{ sourcePath: string; kind: ForeignSessionKind }>,
  mode: ForeignImportMode = 'skip',
  homeDir?: string,
): Promise<ForeignPersistResult[]> {
  const results: ForeignPersistResult[] = []
  for (const item of items) {
    results.push(await persistForeignSession({ workspaceRoot, ...item, mode, homeDir }))
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
