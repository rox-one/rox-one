/**
 * Code-block presentation helpers (LSX-WP-032 narrow slice).
 *
 * Presentation (wrap / fold / line numbers / hide-lines) must NEVER alter
 * original code bytes. Copy and ordinary markdown export always use the full
 * fenced body. Hide/fold is view chrome — not secret redaction.
 */

export type CodeFoldMode = 'none' | 'semi' | 'fold'

export type CodeLineRange = {
  /** 1-based inclusive start */
  start: number
  /** 1-based inclusive end */
  end: number
}

export type CodePresentationAttrs = {
  wrap: boolean
  fold: CodeFoldMode
  lineNumbers: boolean
  lineStart: number
  /** Presentation-only ranges, e.g. "3-5,8". Never redacts content bytes. */
  hideLines: string | null
}

export const DEFAULT_CODE_PRESENTATION: CodePresentationAttrs = {
  wrap: false,
  fold: 'none',
  lineNumbers: false,
  lineStart: 1,
  hideLines: null,
}

/**
 * Affirmative UI framing that treats fold/hide as secret redaction.
 * Educational negations ("not redaction") are allowed — callers should still
 * avoid claiming content was removed for secrecy.
 */
const FORBIDDEN_REDACTION_TERMS = [
  'secret redaction',
  'redacted secret',
  'removed by redaction',
  'скрыто редакцией',
  'редакция секретов',
  'редакция секрета',
  'секретная редакция',
] as const

/** Allowlist for presentation color tokens (SE surface family). No arbitrary CSS. */
const SAFE_COLOR_TOKENS = new Set([
  'accent',
  'foreground',
  'background',
  'success',
  'info',
  'warning',
  'destructive',
  'muted',
  'border-subtle',
  'surface-input',
  'text-primary',
])

const UNSAFE_HTML_ATTR_RE = /^(on\w+|style|srcdoc|formaction|xlink:href)$/i
const EVENT_HANDLER_MARK_RE = /\bon[a-z]+\s*=/i
const UNSAFE_URL_RE = /^\s*(javascript|data|vbscript):/i

export function normalizeFoldMode(value: unknown): CodeFoldMode {
  if (value === 'semi' || value === 'fold' || value === 'none') return value
  if (value === true || value === 'true' || value === 'collapsed') return 'fold'
  return 'none'
}

export function normalizeLineStart(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(Math.floor(n), 1_000_000)
}

export function normalizeBooleanAttr(value: unknown, fallback = false): boolean {
  if (value === true || value === 'true' || value === '' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return fallback
}

export function normalizeHideLinesSpec(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const ranges = parseHideLines(raw)
  if (ranges.length === 0) return null
  return formatHideLines(ranges)
}

export function normalizeCodePresentation(
  attrs: Partial<Record<keyof CodePresentationAttrs, unknown>> | null | undefined,
): CodePresentationAttrs {
  return {
    wrap: normalizeBooleanAttr(attrs?.wrap, false),
    fold: normalizeFoldMode(attrs?.fold),
    lineNumbers: normalizeBooleanAttr(attrs?.lineNumbers, false),
    lineStart: normalizeLineStart(attrs?.lineStart),
    hideLines: normalizeHideLinesSpec(attrs?.hideLines ?? null),
  }
}

export function cycleFoldMode(current: CodeFoldMode): CodeFoldMode {
  if (current === 'none') return 'semi'
  if (current === 'semi') return 'fold'
  return 'none'
}

export function parseHideLines(spec: string | null | undefined): CodeLineRange[] {
  if (!spec) return []
  const ranges: CodeLineRange[] = []
  for (const part of spec.split(/[,\s]+/)) {
    const token = part.trim()
    if (!token) continue
    const m = token.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const start = Number.parseInt(m[1]!, 10)
    const end = m[2] ? Number.parseInt(m[2], 10) : start
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue
    ranges.push({ start, end: Math.min(end, start + 10_000) })
  }
  return mergeRanges(ranges)
}

export function formatHideLines(ranges: CodeLineRange[]): string {
  return mergeRanges(ranges)
    .map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`))
    .join(',')
}

function mergeRanges(ranges: CodeLineRange[]): CodeLineRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: CodeLineRange[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = out[out.length - 1]!
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

export function isLineHidden(line: number, ranges: CodeLineRange[]): boolean {
  return ranges.some((r) => line >= r.start && line <= r.end)
}

export function countHiddenLines(ranges: CodeLineRange[], lineCount: number): number {
  if (ranges.length === 0 || lineCount <= 0) return 0
  let n = 0
  for (let line = 1; line <= lineCount; line++) {
    if (isLineHidden(line, ranges)) n++
  }
  return n
}

export function countCodeLines(code: string): number {
  if (code.length === 0) return 1
  let n = 1
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) n++
  }
  // Trailing newline does not add an extra visible line for gutter purposes.
  if (code.endsWith('\n') && n > 1) n--
  return n
}

export function lineNumberLabels(lineCount: number, lineStart = 1): string[] {
  const start = normalizeLineStart(lineStart)
  const labels: string[] = []
  for (let i = 0; i < Math.max(0, lineCount); i++) {
    labels.push(String(start + i))
  }
  return labels
}

/**
 * Copy / clipboard payload: exact original code bytes from the node.
 * Presentation (fold/hide/wrap) must not change this.
 */
export function codeBytesForCopy(code: string): string {
  return code
}

/**
 * Ordinary TipTap → markdown fence. Always includes the full body even when
 * fold/hide-lines presentation is active.
 */
export function renderCodeFenceMarkdown(language: string | null | undefined, code: string): string {
  const langPart = language ? String(language) : ''
  const body = codeBytesForCopy(code)
  return `\`\`\`${langPart}\n${body}\n\`\`\``
}

export function containsForbiddenRedactionLabel(text: string): boolean {
  const lower = text.toLowerCase()
  return FORBIDDEN_REDACTION_TERMS.some((term) => lower.includes(term.toLowerCase()))
}

export function isUnsafeHtmlAttrName(name: string): boolean {
  return UNSAFE_HTML_ATTR_RE.test(name)
}

export function rejectsUnsafeMarkPayload(payload: string): boolean {
  if (EVENT_HANDLER_MARK_RE.test(payload)) return true
  if (UNSAFE_URL_RE.test(payload)) return true
  if (/<script[\s>]/i.test(payload)) return true
  return false
}

export function sanitizePresentationColorToken(token: string | null | undefined): string | null {
  if (!token) return null
  const normalized = token.trim().toLowerCase().replace(/^--/, '')
  if (!SAFE_COLOR_TOKENS.has(normalized)) return null
  return normalized
}

export function foldModeDatasetValue(fold: CodeFoldMode): string {
  return fold
}
