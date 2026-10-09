/**
 * Pure parser for memory-repository edit imports (Wave A, WP-06).
 *
 * Compares the repository's working-tree files (path + bytes) against the
 * known lesson projection and classifies every divergence as an importable
 * edit. Pure: no fs, no git, no clocks. Output is deterministic and sorted by
 * path so a preview is stable across runs.
 *
 * Shell files (README.md, .gitignore, MEMORY.md, PROFILE.md, history/**,
 * DREAMS.md, .meta.json, .snapshots/**) carry no importable lesson content and
 * are skipped without a record — structural edits are not importable by design.
 */
import { createHash } from 'node:crypto'
import type { MemoryRepoImportEdit } from '@rox/shared/memory/repo'

/** A repository file as read from the working tree. */
export interface RepoImportFile {
  path: string
  content: string
}

/**
 * The known lesson projection for one bank. `baseHash` is the sha1 of the rule
 * text recorded at the last materialization; when it differs from the file's
 * own `baseHash` the materializer and the store disagreed (a concurrent write
 * happened) and the edit must be confirmed explicitly.
 */
export interface RepoImportKnownLesson {
  path: string
  lessonId: string
  ruleHash: string
  rule: string
  disabled: boolean
  baseHash?: string
}

export interface ParseRepoEditsInput {
  bankId: string
  files: RepoImportFile[]
  known: RepoImportKnownLesson[]
}

/** A lesson file parsed out of its frontmatter + body. */
export interface ParsedRepoLessonFile {
  path: string
  id?: string
  scope?: string
  category?: string
  rule: string
  disabled: boolean
  baseHash?: string
}

const LESSON_PATH = /^lessons\/[^\n]+\.md$/i
const FRONTMATTER_KEYS = new Set([
  'id',
  'scope',
  'category',
  'negative',
  'pinned',
  'disabled',
  'tags',
  'ts',
  'editedat',
  'basehash',
])

/** sha1 hex of the canonical rule text — must match the materializer's `ruleHash`. */
export function repoRuleHash(rule: string): string {
  return createHash('sha1').update((rule ?? '').normalize('NFKC').trim()).digest('hex')
}

/** True when a repository path is a candidate lesson file (everything else is skipped). */
export function isLessonRepoPath(path: string): boolean {
  return LESSON_PATH.test(path)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Read a lesson file's frontmatter (`---` fenced head) and body. The body after
 * the closing fence is the rule text. Malformed input degrades to an empty id
 * with the whole content as the rule — the caller classifies it as unknown.
 */
export function parseLessonRepoFile(file: RepoImportFile): ParsedRepoLessonFile {
  const out: ParsedRepoLessonFile = { path: file.path, rule: '', disabled: false }
  const content = file.content ?? ''
  if (!content.startsWith('---')) {
    out.rule = content.trim()
    return out
  }
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') {
    out.rule = content.trim()
    return out
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') { end = i; break }
  }
  if (end < 0) {
    out.rule = content.trim()
    return out
  }
  for (let i = 1; i < end; i++) {
    const line = lines[i]!
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = (match[1] ?? '').toLowerCase()
    if (!FRONTMATTER_KEYS.has(key)) continue
    const value = unquote(match[2] ?? '')
    if (key === 'id' && value) out.id = value
    else if (key === 'scope' && value) out.scope = value
    else if (key === 'category' && value) out.category = value
    else if (key === 'disabled') out.disabled = value.toLowerCase() === 'true'
    else if (key === 'basehash' && value) out.baseHash = value
  }
  out.rule = lines.slice(end + 1).join('\n').trim()
  return out
}

type DiffOp = { type: 'equal' | 'del' | 'ins'; line: string }

function diffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'equal', line: a[i]! }); i++; j++ }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ type: 'del', line: a[i]! }); i++ }
    else { ops.push({ type: 'ins', line: b[j]! }); j++ }
  }
  while (i < n) { ops.push({ type: 'del', line: a[i]! }); i++ }
  while (j < m) { ops.push({ type: 'ins', line: b[j]! }); j++ }
  return ops
}

const DIFF_CONTEXT = 3

/** Deterministic tie-break order when two edits share a path. */
const KIND_ORDER: Record<string, number> = { add: 0, update: 1, delete: 2 }

/**
 * Compact unified diff of two rule texts with 3 lines of context, no
 * dependencies. Returns '' when the texts are identical. `path` labels the
 * `---`/`+++` headers when provided.
 */
export function unifiedDiff(oldText: string, newText: string, path?: string): string {
  const a = (oldText ?? '').length ? (oldText ?? '').split('\n') : []
  const b = (newText ?? '').length ? (newText ?? '').split('\n') : []
  if (a.join('\n') === b.join('\n')) return ''
  const ops = diffOps(a, b)
  // Cumulative 1-based positions for each op.
  const entries = ops.map((op) => {
    const entry = { op, aLine: 1, bLine: 1 }
    return entry
  })
  let aPos = 1
  let bPos = 1
  for (const entry of entries) {
    entry.aLine = aPos
    entry.bLine = bPos
    if (entry.op.type === 'equal') { aPos++; bPos++ }
    else if (entry.op.type === 'del') aPos++
    else bPos++
  }

  const changed: number[] = []
  for (let k = 0; k < entries.length; k++) if (entries[k]!.op.type !== 'equal') changed.push(k)
  if (changed.length === 0) return ''

  const clusters: Array<[number, number]> = []
  let start = changed[0]!
  let prev = changed[0]!
  for (let c = 1; c < changed.length; c++) {
    const cur = changed[c]!
    if (cur - prev > 2 * DIFF_CONTEXT + 1) {
      clusters.push([start, prev])
      start = cur
    }
    prev = cur
  }
  clusters.push([start, prev])

  const lines: string[] = []
  if (path) {
    lines.push(`--- a/${path}`)
    lines.push(`+++ b/${path}`)
  }
  for (const [s, e] of clusters) {
    let begin = s
    let left = DIFF_CONTEXT
    while (begin > 0 && left > 0) { begin--; left-- }
    let finish = e
    let right = DIFF_CONTEXT
    while (finish < entries.length - 1 && right > 0) { finish++; right-- }
    const slice = entries.slice(begin, finish + 1)
    const aLen = slice.filter((x) => x.op.type === 'equal' || x.op.type === 'del').length
    const bLen = slice.filter((x) => x.op.type === 'equal' || x.op.type === 'ins').length
    const aStart = aLen === 0 ? entries[begin]!.aLine - 1 : entries[begin]!.aLine
    const bStart = bLen === 0 ? entries[begin]!.bLine - 1 : entries[begin]!.bLine
    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`)
    for (const entry of slice) {
      const prefix = entry.op.type === 'equal' ? ' ' : entry.op.type === 'del' ? '-' : '+'
      lines.push(`${prefix}${entry.op.line}`)
    }
  }
  return lines.join('\n')
}

/**
 * Classify repository files against the known projection.
 *
 * - a lesson file with a matching id and a changed rule (or a flipped
 *   `disabled`) → `update`, tagged `conflict:'rule-changed'` when the stored
 *   `baseHash` differs from the file's own;
 * - a lesson file with an unknown id → `add`;
 * - a known lesson whose file is gone → `delete`;
 * - shell files and lesson files with no actual change → nothing.
 */
export function parseRepoEdits(input: ParseRepoEditsInput): MemoryRepoImportEdit[] {
  const knownById = new Map(input.known.map((lesson) => [lesson.lessonId, lesson]))
  const seenIds = new Set<string>()
  const edits: MemoryRepoImportEdit[] = []

  for (const file of input.files) {
    if (!isLessonRepoPath(file.path)) continue
    const parsed = parseLessonRepoFile(file)
    if (!parsed.id) {
      edits.push({
        path: file.path,
        kind: 'add',
        rule: parsed.rule || undefined,
        conflict: 'unknown-id',
      })
      continue
    }
    seenIds.add(parsed.id)
    const known = knownById.get(parsed.id)
    if (!known) {
      edits.push({
        path: file.path,
        kind: 'add',
        lessonId: parsed.id,
        rule: parsed.rule || undefined,
        diff: unifiedDiff('', parsed.rule, file.path) || undefined,
      })
      continue
    }
    const ruleChanged = repoRuleHash(parsed.rule) !== known.ruleHash
    const disabledChanged = parsed.disabled !== known.disabled
    if (!ruleChanged && !disabledChanged) continue
    const baseHashMismatch = Boolean(
      parsed.baseHash && known.baseHash && parsed.baseHash !== known.baseHash,
    )
    edits.push({
      path: file.path,
      kind: 'update',
      lessonId: parsed.id,
      rule: parsed.rule || undefined,
      diff: ruleChanged ? (unifiedDiff(known.rule, parsed.rule, file.path) || undefined) : undefined,
      ...(baseHashMismatch ? { conflict: 'rule-changed' as const } : {}),
    })
  }

  for (const known of input.known) {
    if (seenIds.has(known.lessonId)) continue
    edits.push({
      path: known.path,
      kind: 'delete',
      lessonId: known.lessonId,
      rule: known.rule || undefined,
    })
  }

  return edits.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    return (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3)
  })
}