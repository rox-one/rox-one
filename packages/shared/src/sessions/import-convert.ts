/**
 * Pure converters: foreign chat files → Rox-shaped messages.
 * Never writes disk. Secrets become [redacted] + an anomaly, not a transcript leak.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { foreignImportRoots, isAllowedForeignSourcePath, realOrResolve } from './import-home.ts'
import type {
  ConvertedForeignMessage,
  ConvertedForeignSession,
  ForeignSessionKind,
} from './import-types.ts'

export const MAX_FOREIGN_FILE_BYTES = 5 * 1024 * 1024

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
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
]

export type ForeignSourceGuard = 'ok' | 'missing' | 'symlink' | 'too-large' | 'not-file'

export function inspectForeignSource(path: string): { status: ForeignSourceGuard; size?: number } {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return { status: 'symlink' }
    if (st.isDirectory()) return { status: 'ok', size: st.size }
    if (!st.isFile()) return { status: 'not-file' }
    if (st.size > MAX_FOREIGN_FILE_BYTES) return { status: 'too-large', size: st.size }
    return { status: 'ok', size: st.size }
  } catch {
    return { status: 'missing' }
  }
}

export function readRegularFile(path: string, maxBytes = MAX_FOREIGN_FILE_BYTES): string | null {
  const guard = inspectForeignSource(path)
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
    return typeof text === 'string' ? text : ''
  }
  return ''
}

function emptyConverted(
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

function parseGenericRow(
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
  const role = nestedRole ?? roleRaw
  if (role !== 'user' && role !== 'assistant') return
  const content = message?.content ?? rec.content
  const text = extractText(content)
  const ts =
    typeof rec.timestamp === 'number'
      ? rec.timestamp
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

const KIND_BY_ROOT_SUFFIX: Array<{ suffix: string; kind: ForeignSessionKind }> = [
  { suffix: '/.grok/sessions', kind: 'grok' },
  { suffix: '/.claude/projects', kind: 'claude' },
  { suffix: '/.codex/sessions', kind: 'codex' },
  { suffix: '/.local/share/opencode', kind: 'opencode' },
  { suffix: '/.hermes', kind: 'hermes' },
  { suffix: '/.opencode', kind: 'opencode' },
]

export function inferForeignKind(sourcePath: string, homeDir?: string): ForeignSessionKind | undefined {
  if (!isAllowedForeignSourcePath(sourcePath, homeDir)) return undefined
  const resolved = realOrResolve(sourcePath).replaceAll('\\', '/')
  const roots = foreignImportRoots(homeDir).map((root) => realOrResolve(root).replaceAll('\\', '/'))
  for (const root of roots) {
    if (resolved === root || resolved.startsWith(`${root}/`)) {
      const match = KIND_BY_ROOT_SUFFIX.find((entry) => root.endsWith(entry.suffix) || root.includes(entry.suffix))
      return match?.kind
    }
  }
  return undefined
}

export function convertForeignSource(sourcePath: string, kind: ForeignSessionKind): ConvertedForeignSession {
  const guard = inspectForeignSource(sourcePath)
  if (guard.status === 'missing') return emptyConverted(sourcePath, kind, 'source-unreadable')
  if (guard.status === 'symlink') return emptyConverted(sourcePath, kind, 'source-symlink')
  if (guard.status === 'too-large') return emptyConverted(sourcePath, kind, 'source-too-large')
  if (kind === 'grok') {
    const dir = sourcePath.endsWith('summary.json') ? dirname(sourcePath) : sourcePath
    return convertGrokCatalog(dir)
  }
  try {
    if (lstatSync(sourcePath).isDirectory()) {
      const history = join(sourcePath, 'chat_history.jsonl')
      if (inspectForeignSource(history).status === 'ok') return convertGrokCatalog(sourcePath)
    }
  } catch {
    return emptyConverted(sourcePath, kind, 'source-unreadable')
  }
  return convertJsonlFile(sourcePath, kind)
}
