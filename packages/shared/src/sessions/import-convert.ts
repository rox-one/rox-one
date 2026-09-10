/**
 * Pure converters: foreign chat files → Rox-shaped messages.
 * Never writes disk. Secrets become [redacted] + an anomaly, not a transcript leak.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  ConvertedForeignMessage,
  ConvertedForeignSession,
  ForeignSessionKind,
} from './import-types.ts'

const SECRET_RE =
  /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._\-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+|(?:api[_-]?key|token|cookie)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{16,})/gi

export function redactSecrets(text: string): { text: string; hit: boolean } {
  const next = text.replace(SECRET_RE, '[redacted]')
  return { text: next, hit: next !== text }
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

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
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
  return rows
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
  const summaryPath = join(dir, 'summary.json')
  const historyPath = join(dir, 'chat_history.jsonl')
  let title = basename(dir)
  let cwd: string | undefined
  const anomalies: string[] = []
  if (existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>
      const info = asRecord(summary.info)
      if (typeof info?.cwd === 'string') cwd = info.cwd
      title =
        (typeof summary.generated_title === 'string' && summary.generated_title) ||
        (typeof summary.session_summary === 'string' && summary.session_summary) ||
        title
    } catch {
      anomalies.push('summary-unreadable')
    }
  }
  const messages: ConvertedForeignMessage[] = []
  for (const row of readJsonl(historyPath)) {
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
  const anomalies: string[] = []
  const messages: ConvertedForeignMessage[] = []
  for (const row of readJsonl(path)) {
    parseGenericRow(row, messages, anomalies)
  }
  let cwd: string | undefined
  for (const row of readJsonl(path)) {
    const rec = asRecord(row)
    if (typeof rec?.cwd === 'string') {
      cwd = rec.cwd
      break
    }
  }
  return {
    sourcePath: path,
    kind: 'claude',
    title: basename(path, '.jsonl'),
    cwd,
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

export function convertJsonlFile(path: string, kind: ForeignSessionKind): ConvertedForeignSession {
  if (kind === 'claude') return convertClaudeJsonl(path)
  const anomalies: string[] = []
  const messages: ConvertedForeignMessage[] = []
  for (const row of readJsonl(path)) parseGenericRow(row, messages, anomalies)
  return {
    sourcePath: path,
    kind,
    title: basename(path, '.jsonl'),
    messages,
    userTurns: messages.filter((m) => m.role === 'user').length,
    anomalies: [...new Set(anomalies)],
  }
}

export function inferForeignKind(sourcePath: string): ForeignSessionKind {
  const n = sourcePath.replaceAll('\\', '/')
  if (n.includes('/.grok/sessions/')) return 'grok'
  if (n.includes('/.claude/projects/')) return 'claude'
  if (n.includes('/.codex/sessions/')) return 'codex'
  if (n.includes('opencode')) return 'opencode'
  if (n.includes('/.hermes/')) return 'hermes'
  if (existsSync(join(sourcePath, 'summary.json')) || existsSync(join(sourcePath, 'chat_history.jsonl'))) {
    return 'grok'
  }
  return 'claude'
}

export function convertForeignSource(sourcePath: string, kind: ForeignSessionKind): ConvertedForeignSession {
  if (kind === 'grok') {
    const dir = sourcePath.endsWith('summary.json') ? dirname(sourcePath) : sourcePath
    return convertGrokCatalog(dir)
  }
  if (statSync(sourcePath).isDirectory()) {
    const history = join(sourcePath, 'chat_history.jsonl')
    if (existsSync(history)) return convertGrokCatalog(sourcePath)
  }
  return convertJsonlFile(sourcePath, kind)
}
