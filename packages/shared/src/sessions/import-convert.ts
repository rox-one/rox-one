/**
 * Pure converters: foreign chat files → Rox-shaped messages.
 * Never writes disk. Secrets become [redacted] + an anomaly, not a transcript leak.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { inferKindFromAllowlistedPath, splitForeignSourceRef } from './import-home.ts'
import type {
  ConvertedForeignMessage,
  ConvertedForeignSession,
  ForeignSessionKind,
} from './import-types.ts'

export const MAX_FOREIGN_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FOREIGN_EXPORT_BYTES = 32 * 1024 * 1024

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk_live_[A-Za-z0-9]{16,}/g,
  /xai-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /glpat-[A-Za-z0-9_-]{16,}/g,
  /hf_[A-Za-z0-9]{16,}/g,
  /npm_[A-Za-z0-9]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{30,}/gi,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g,
  /(?:api[_-]?key|token|cookie)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{16,}/gi,
  /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----[\s\S]{0,100000}?-----END [A-Z0-9 ]{0,64}PRIVATE KEY-----/g,
]

export type ForeignSourceGuard = 'ok' | 'missing' | 'symlink' | 'too-large' | 'not-file'

export function inspectForeignSource(
  path: string,
  maxBytes = MAX_FOREIGN_FILE_BYTES,
): { status: ForeignSourceGuard; size?: number } {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return { status: 'symlink' }
    if (st.isDirectory()) return { status: 'ok', size: st.size }
    if (!st.isFile()) return { status: 'not-file' }
    if (st.size > maxBytes) return { status: 'too-large', size: st.size }
    return { status: 'ok', size: st.size }
  } catch {
    return { status: 'missing' }
  }
}

export function readRegularFile(path: string, maxBytes = MAX_FOREIGN_FILE_BYTES): string | null {
  const guard = inspectForeignSource(path, maxBytes)
  if (guard.status !== 'ok') return null
  let fd: number | undefined
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    fd = openSync(path, flags)
    const st = fstatSync(fd)
    if (st.isDirectory()) return null
    if (!st.isFile() || st.size > maxBytes) return null
    return readFileSync(fd, 'utf8')
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

export function redactSecrets(text: string): { text: string; hit: boolean } {
  let next = text
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    next = next.replace(pattern, '[redacted]')
  }
  return { text: next, hit: next !== text }
}

function redactMeta(value: string | undefined): { text?: string; hit: boolean } {
  if (!value) return { hit: false }
  const { text, hit } = redactSecrets(value)
  return { text, hit }
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const rec = part as Record<string, unknown>
        if (typeof rec.text === 'string') return rec.text
        if (rec.type === 'text' && typeof rec.text === 'string') return rec.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object' && 'text' in content) {
    const text = (content as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  if (content && typeof content === 'object' && 'parts' in content) {
    const parts = (content as { parts?: unknown }).parts
    if (Array.isArray(parts)) {
      return parts
        .map((part) => (typeof part === 'string' ? part : extractText(part)))
        .filter(Boolean)
        .join('\n')
    }
  }
  return ''
}

export function coerceChatRole(raw: string | undefined): 'user' | 'assistant' | undefined {
  if (!raw) return undefined
  const role = raw.toLowerCase()
  if (role === 'user' || role === 'human' || role === 'prompter') return 'user'
  if (
    role === 'assistant' ||
    role === 'gemini' ||
    role === 'model' ||
    role === 'ai' ||
    role === 'bot'
  ) {
    return 'assistant'
  }
  return undefined
}

export function emptyConverted(
  sourcePath: string,
  kind: ForeignSessionKind,
  anomaly: string,
): ConvertedForeignSession {
  return {
    sourcePath,
    kind,
    title: basename(sourcePath, '.jsonl'),
    messages: [],
    userTurns: 0,
    anomalies: [anomaly],
  }
}

function readJsonl(path: string): { rows: unknown[]; anomaly?: string } {
  const guard = inspectForeignSource(path)
  if (guard.status === 'missing') return { rows: [] }
  if (guard.status !== 'ok') return { rows: [], anomaly: `source-${guard.status}` }
  const raw = readRegularFile(path)
  if (raw === null) return { rows: [], anomaly: 'source-unreadable' }
  const rows: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      rows.push(JSON.parse(trimmed) as unknown)
    } catch {
      // skip malformed line
    }
  }
  return { rows }
}

function pushMessage(
  messages: ConvertedForeignMessage[],
  anomalies: string[],
  role: 'user' | 'assistant',
  raw: string,
  timestamp?: number,
): void {
  const { text, hit } = redactSecrets(raw.trim())
  if (!text) return
  if (hit) anomalies.push('secret-redacted')
  messages.push({ role, content: text, timestamp })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseGenericRow(
  row: unknown,
  messages: ConvertedForeignMessage[],
  anomalies: string[],
): void {
  const rec = asRecord(row)
  if (!rec) return
  if (rec.isSidechain === true) return
  const type = typeof rec.type === 'string' ? rec.type : undefined
  const roleRaw = typeof rec.role === 'string' ? rec.role : type
  const message = asRecord(rec.message)
  const nestedRole = typeof message?.role === 'string' ? message.role : undefined
  const role = coerceChatRole(nestedRole ?? roleRaw)
  if (!role) return
  const content = message?.content ?? rec.content ?? rec.parts
  const text = extractText(content)
  const ts =
    typeof rec.timestamp === 'number'
      ? rec.timestamp
      : typeof rec.create_time === 'number'
        ? rec.create_time * (rec.create_time < 1e12 ? 1000 : 1)
        : typeof rec.timestamp === 'string'
          ? Date.parse(rec.timestamp)
          : undefined
  pushMessage(messages, anomalies, role, text, Number.isFinite(ts) ? ts : undefined)
}

export function convertGrokCatalog(dir: string): ConvertedForeignSession {
  const dirGuard = inspectForeignSource(dir)
  if (dirGuard.status === 'symlink') return emptyConverted(dir, 'grok', 'source-symlink')
  if (dirGuard.status === 'missing') return emptyConverted(dir, 'grok', 'source-unreadable')

  const summaryPath = join(dir, 'summary.json')
  const historyPath = join(dir, 'chat_history.jsonl')
  let title = basename(dir)
  let cwd: string | undefined
  const anomalies: string[] = []
  const summaryRaw = readRegularFile(summaryPath)
  if (summaryRaw !== null) {
    try {
      const summary = JSON.parse(summaryRaw) as Record<string, unknown>
      const info = asRecord(summary.info)
      if (typeof info?.cwd === 'string') cwd = info.cwd
      title =
        (typeof summary.generated_title === 'string' && summary.generated_title) ||
        (typeof summary.session_summary === 'string' && summary.session_summary) ||
        title
    } catch {
      anomalies.push('summary-unreadable')
    }
  } else if (inspectForeignSource(summaryPath).status === 'too-large') {
    anomalies.push('source-too-large')
  } else if (inspectForeignSource(summaryPath).status === 'symlink') {
    anomalies.push('source-symlink')
  }
  const titleRedact = redactMeta(title)
  title = titleRedact.text ?? title
  if (titleRedact.hit) anomalies.push('secret-redacted')
  const cwdRedact = redactMeta(cwd)
  cwd = cwdRedact.text
  if (cwdRedact.hit) anomalies.push('secret-redacted')

  const messages: ConvertedForeignMessage[] = []
  const history = readJsonl(historyPath)
  if (history.anomaly) anomalies.push(history.anomaly)
  for (const row of history.rows) {
    const rec = asRecord(row)
    if (!rec) continue
    const type = rec.type
    if (type !== 'user' && type !== 'assistant') continue
    parseGenericRow(row, messages, anomalies)
  }
  return {
    sourcePath: dir,
    kind: 'grok',
    title,
    cwd,
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

export function convertClaudeJsonl(path: string): ConvertedForeignSession {
  const guard = inspectForeignSource(path)
  if (guard.status !== 'ok') return emptyConverted(path, 'claude', `source-${guard.status}`)
  const anomalies: string[] = []
  const messages: ConvertedForeignMessage[] = []
  const parsed = readJsonl(path)
  if (parsed.anomaly) anomalies.push(parsed.anomaly)
  for (const row of parsed.rows) {
    parseGenericRow(row, messages, anomalies)
  }
  let cwd: string | undefined
  for (const row of parsed.rows) {
    const rec = asRecord(row)
    if (typeof rec?.cwd === 'string') {
      cwd = rec.cwd
      break
    }
  }
  const titleRedact = redactMeta(basename(path, '.jsonl'))
  const cwdRedact = redactMeta(cwd)
  if (titleRedact.hit || cwdRedact.hit) anomalies.push('secret-redacted')
  return {
    sourcePath: path,
    kind: 'claude',
    title: titleRedact.text ?? basename(path, '.jsonl'),
    cwd: cwdRedact.text,
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

export function convertJsonlFile(path: string, kind: ForeignSessionKind): ConvertedForeignSession {
  if (kind === 'claude') return convertClaudeJsonl(path)
  const guard = inspectForeignSource(path)
  if (guard.status !== 'ok') return emptyConverted(path, kind, `source-${guard.status}`)
  const anomalies: string[] = []
  const messages: ConvertedForeignMessage[] = []
  const parsed = readJsonl(path)
  if (parsed.anomaly) anomalies.push(parsed.anomaly)
  for (const row of parsed.rows) parseGenericRow(row, messages, anomalies)
  const titleRedact = redactMeta(basename(path, '.jsonl'))
  if (titleRedact.hit) anomalies.push('secret-redacted')
  return {
    sourcePath: path,
    kind,
    title: titleRedact.text ?? basename(path, '.jsonl'),
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

function chatgptNodeMessage(node: Record<string, unknown>): unknown {
  const message = asRecord(node.message)
  if (!message) return null
  const author = asRecord(message.author)
  const role = coerceChatRole(typeof author?.role === 'string' ? author.role : undefined)
  if (!role) return null
  return {
    role,
    content: message.content,
    create_time: message.create_time,
    timestamp: message.create_time,
  }
}

function conversationFromMapping(
  rec: Record<string, unknown>,
  fallbackId: string,
): { id: string; title: string; rows: unknown[] } {
  const id =
    (typeof rec.id === 'string' && rec.id) ||
    (typeof rec.conversation_id === 'string' && rec.conversation_id) ||
    fallbackId
  const title = typeof rec.title === 'string' && rec.title.trim() ? rec.title : id
  const mapping = asRecord(rec.mapping)
  const rows: unknown[] = []
  if (mapping) {
    for (const node of Object.values(mapping)) {
      const recNode = asRecord(node)
      if (!recNode) continue
      const row = chatgptNodeMessage(recNode)
      if (row) rows.push(row)
    }
  }
  return { id, title, rows }
}

function conversationsFromJson(value: unknown, fileBase: string): Array<{ id: string; title: string; rows: unknown[] }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => conversationsFromJson(item, `${fileBase}-${index}`))
  }
  const rec = asRecord(value)
  if (!rec) return []
  if (Array.isArray(rec.conversations)) {
    return rec.conversations.flatMap((item, index) => conversationsFromJson(item, `${fileBase}-${index}`))
  }
  if (asRecord(rec.mapping)) return [conversationFromMapping(rec, fileBase)]
  const messages = rec.messages ?? rec.chat ?? rec.history
  if (Array.isArray(messages)) {
    const id =
      (typeof rec.id === 'string' && rec.id) ||
      (typeof rec.sessionId === 'string' && rec.sessionId) ||
      fileBase
    const title =
      (typeof rec.title === 'string' && rec.title.trim() && rec.title) ||
      (typeof rec.name === 'string' && rec.name.trim() && rec.name) ||
      id
    return [{ id, title, rows: messages }]
  }
  return []
}

export function listChatExportConversations(
  path: string,
): Array<{ id: string; title: string; userTurns: number }> {
  const raw = readRegularFile(path, MAX_FOREIGN_EXPORT_BYTES)
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return conversationsFromJson(parsed, basename(path, '.json')).map((conv) => ({
      id: conv.id,
      title: conv.title,
      userTurns: conv.rows.reduce((count: number, row) => {
        const rec = asRecord(row)
        const role = coerceChatRole(
          typeof rec?.role === 'string'
            ? rec.role
            : typeof rec?.type === 'string'
              ? rec.type
              : undefined,
        )
        return role === 'user' ? count + 1 : count
      }, 0),
    }))
  } catch {
    return []
  }
}

export function convertStructuredChatFile(
  path: string,
  kind: ForeignSessionKind,
  fragment?: string,
  sourcePath = path,
): ConvertedForeignSession {
  const guard = inspectForeignSource(path, MAX_FOREIGN_EXPORT_BYTES)
  if (guard.status !== 'ok') return emptyConverted(sourcePath, kind, `source-${guard.status}`)
  const raw = readRegularFile(path, MAX_FOREIGN_EXPORT_BYTES)
  if (raw === null) return emptyConverted(sourcePath, kind, 'source-unreadable')
  const anomalies: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return emptyConverted(sourcePath, kind, 'source-unreadable')
  }
  const conversations = conversationsFromJson(parsed, basename(path, '.json'))
  const selected = fragment
    ? conversations.filter((conv) => conv.id === fragment)
    : conversations
  const messages: ConvertedForeignMessage[] = []
  for (const conv of selected) {
    for (const row of conv.rows) parseGenericRow(row, messages, anomalies)
  }
  const titleSource = selected.length === 1 ? selected[0]!.title : basename(path, '.json')
  const titleRedact = redactSecrets(titleSource)
  if (titleRedact.hit) anomalies.push('secret-redacted')
  return {
    sourcePath,
    kind,
    title: titleRedact.text,
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

export function inferForeignKind(sourcePath: string, homeDir?: string): ForeignSessionKind | undefined {
  return inferKindFromAllowlistedPath(sourcePath, homeDir)
}

function isJsonChatFile(path: string): boolean {
  return path.endsWith('.json') && !path.endsWith('.jsonl')
}

export function convertForeignSource(sourcePath: string, kind: ForeignSessionKind): ConvertedForeignSession {
  const { path, fragment } = splitForeignSourceRef(sourcePath)
  const maxBytes = isJsonChatFile(path) ? MAX_FOREIGN_EXPORT_BYTES : MAX_FOREIGN_FILE_BYTES
  const guard = inspectForeignSource(path, maxBytes)
  if (guard.status === 'missing') return emptyConverted(sourcePath, kind, 'source-unreadable')
  if (guard.status === 'symlink') return emptyConverted(sourcePath, kind, 'source-symlink')
  if (guard.status === 'too-large') return emptyConverted(sourcePath, kind, 'source-too-large')
  if (kind === 'grok') {
    const dir = path.endsWith('summary.json') ? dirname(path) : path
    return convertGrokCatalog(dir)
  }
  try {
    if (lstatSync(path).isDirectory()) {
      const history = join(path, 'chat_history.jsonl')
      if (inspectForeignSource(history).status === 'ok') return convertGrokCatalog(path)
    }
  } catch {
    return emptyConverted(sourcePath, kind, 'source-unreadable')
  }
  if (fragment || isJsonChatFile(path)) {
    return convertStructuredChatFile(path, kind, fragment, sourcePath)
  }
  return convertJsonlFile(path, kind)
}
