/**
 * W1-10 (#1507) — negative-test presence gate (PLAN §1.4 v2 definition of done).
 *
 * Every GATED command (bound handler or `schemaBound: true`; see
 * catalogue.ts) needs its own negative test: permission denied, wrong
 * scope, rate limited, quota exceeded, conflict, expired approval. Unbound
 * catalogue placeholders are reported as pending (owner decision).
 * Exceptions: `negativeTests` in
 * `packages/test-harness/allowlists/command-gates.json` (shrink-only).
 *
 * Coverage is decided per test block, per command. A `test(…)` / `it(…)`
 * call (not `.skip` / `.todo` / `.skipIf` / `.failing`) covers a command
 * when it names the command id as a whole token (in the block, its title
 * or an enclosing `describe` title) AND shows a negative outcome:
 * - a negative keyword as a whole word in the test title or an enclosing
 *   describe title (`denied`, `forbidden`, `wrong scope`, `rate limit…`,
 *   `quota`, `conflict…`, `expired`), or
 * - an assertion / error-code token in the body: a string literal that is
 *   exactly an error code (`'FORBIDDEN'`, `'RATE_LIMITED'`,
 *   `'QUOTA_EXCEEDED'`, `'APPROVAL_EXPIRED'`, `'conflict'`, …) or an HTTP
 *   403 / 409 / 429 status assertion.
 * Identifiers such as `resolveConflict`, `quotaBytes` or `notExpired` in a
 * happy-path body do not count.
 *
 * Walk: only test files (`*.test.ts(x)`, `*.spec.ts(x)`) under the test
 * roots (`packages`, `apps/workspace-service`, `tests`, `e2e`), skipping
 * `packages/test-harness` (its self-tests carry synthetic fixtures),
 * node_modules / .git / dist / build / coverage / resources, and never
 * following symlinks.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { GateResult } from './types.ts'
import { CATALOGUE_PATH, COMMAND_ALLOWLIST_PATH, commandGateResult, loadCatalogue, matchBracket, stripJsComments, type CatalogueInputs } from './catalogue.ts'
import { resolveAllowlist, type AllowlistInputs } from './allowlist.ts'

export { CATALOGUE_PATH }

/** Whole-word negative keywords, matched on test / describe titles only. */
export const NEGATIVE_TITLE_RE =
  /\b(?:permission[ _-]denied|denied|forbidden|wrong[ _-]scope|out[ _-]of[ _-]scope|rate[ _-]?limit(?:ed|s)?|quota(?:[ _-]exceeded)?|conflicts?|expired)\b/i

/** Error-code tokens that count when they appear as an exact string literal in a test body. */
export const NEGATIVE_CODE_TOKENS = [
  'FORBIDDEN', 'PERMISSION_DENIED', 'WRONG_SCOPE', 'SCOPE_MISMATCH', 'RATE_LIMITED', 'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED', 'CONFLICT', 'APPROVAL_EXPIRED', 'EXPIRED',
  'forbidden', 'permission_denied', 'wrong_scope', 'rate_limited', 'quota_exceeded', 'conflict', 'approval_expired', 'expired',
] as const

const CODE_LITERAL_RE = new RegExp(`(['"\`])(?:${NEGATIVE_CODE_TOKENS.join('|')})\\1`)
const HTTP_STATUS_RE = /\b(?:toBe|toEqual|toStrictEqual)\(\s*(?:403|409|429)\s*\)|\bstatus\s*:\s*(?:403|409|429)\b/

export const DEFAULT_TEST_ROOTS = ['packages', join('apps', 'workspace-service'), 'tests', 'e2e'] as const
/** Repo-relative directories never walked (self-test fixtures live there). */
export const EXCLUDED_TEST_DIRS = [join('packages', 'test-harness')] as const
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', 'resources', '.turbo', '.cache'])
const TEST_FILE_RE = /\.(?:test|spec)\.tsx?$/

export function collectTestFiles(dir: string, out: string[], opts: { root?: string; exclude?: readonly string[] } = {}): void {
  let entries: string[]
  try {
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return
    entries = readdirSync(dir)
  } catch {
    return
  }
  const exclude = opts.exclude ?? []
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (opts.root) {
      const rel = relative(opts.root, full)
      if (exclude.some((x) => rel === x || rel.startsWith(x + sep))) continue
    }
    let st
    try {
      st = lstatSync(full)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) collectTestFiles(full, out, opts)
    else if (st.isFile() && TEST_FILE_RE.test(entry)) out.push(full)
  }
}

interface Block { start: number; end: number; kind: 'describe' | 'test'; text: string; title: string }

/** describe / test / it blocks with their source text; skipped and todo tests are dropped. */
export function testBlocks(source: string): Block[] {
  const text = stripJsComments(source)
  const blocks: Block[] = []
  const re = /\b(describe|test|it)((?:\.[A-Za-z]+)*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(text, open)
    if (close === -1) continue
    const modifiers = m[2] ?? ''
    if (/\.(?:skip|todo|skipIf|failing)\b/.test(modifiers)) continue
    const inner = text.slice(open + 1, close)
    const titleMatch = /^\s*(['"`])([\s\S]*?)\1/.exec(inner)
    blocks.push({
      start: open,
      end: close,
      kind: m[1] === 'describe' ? 'describe' : 'test',
      text: inner,
      title: titleMatch?.[2] ?? '',
    })
  }
  return blocks
}

function tokenRe(id: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_.])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i')
}

/** True when the block shows a negative outcome (title keyword or body code token). */
export function isNegativeBlock(titles: string, body: string): boolean {
  return NEGATIVE_TITLE_RE.test(titles) || CODE_LITERAL_RE.test(body) || HTTP_STATUS_RE.test(body)
}

/** Negative-test coverage per command id within one test source. */
export function coveredCommands(source: string, ids: string[]): Set<string> {
  const blocks = testBlocks(source)
  const describes = blocks.filter((b) => b.kind === 'describe')
  const covered = new Set<string>()
  for (const t of blocks.filter((b) => b.kind === 'test')) {
    const context = describes.filter((d) => d.start < t.start && d.end > t.end).map((d) => d.title)
    const titles = [...context, t.title].join('\n')
    if (!isNegativeBlock(titles, t.text)) continue
    const haystack = `${titles}\n${t.text}`
    for (const id of ids) if (tokenRe(id).test(haystack)) covered.add(id)
  }
  return covered
}

export async function checkNegativeTestPresence(opts: CatalogueInputs & {
  testRoots?: string[]
  allowlist?: AllowlistInputs
} = {}): Promise<GateResult> {
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const readout = await loadCatalogue(opts)
  const allowlist = readout.present ? resolveAllowlist(root, COMMAND_ALLOWLIST_PATH, 'negativeTests', opts.allowlist) : { entries: [], problems: [] }
  const covered = new Set<string>()
  if (readout.present) {
    const ids = [...new Set(readout.commands.filter((c) => c.gated).map((c) => c.type))]
    const testFiles: string[] = []
    for (const r of opts.testRoots ?? DEFAULT_TEST_ROOTS.map((p) => join(root, p))) {
      collectTestFiles(r, testFiles, { root, exclude: EXCLUDED_TEST_DIRS })
    }
    for (const f of testFiles) {
      let src: string
      try {
        src = readFileSync(f, 'utf8')
      } catch {
        continue
      }
      for (const id of coveredCommands(src, ids)) covered.add(id)
    }
  }
  return commandGateResult({
    gate: 'negative-tests',
    readout,
    allowlist,
    okNoun: 'have negative tests',
    check: (cmd) => (covered.has(cmd.type) ? null : `command '${cmd.type}' (${cmd.module}) is gated but has no negative test block (permission/scope/rate-limit/quota/conflict/expiry)`),
  })
}
