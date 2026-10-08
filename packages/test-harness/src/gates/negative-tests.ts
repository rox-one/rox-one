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
 * Supported test shapes (TEST_SHAPES_HELP; #1507 review 4):
 * - `test(title, fn)` / `it(title, fn)`, with modifiers such as `.only` /
 *   `.concurrent`, nested in `describe(title, fn)`;
 * - `test.each(table)(title, fn)`, `it.each(table)(title, fn)` and
 *   `describe.each(table)(title, fn)`: parsed as ONE test (or describe)
 *   whose title is the `(title, fn)` call's title (a `'%s'` / `$id` /
 *   template string counts as written) and whose string literals in
 *   `table` that are exactly a command id count as titles too;
 * - titles may be '…', "…" or `…` template literals; an id only counts when
 *   it is literal (in a title, an `.each` table or the negative assertion),
 *   so a loop such as `for (const id of ids) test(`${id} denied`, …)` does
 *   not cover anything — use `.each` instead.
 * Not parsed: `.skip` / `.todo` / `.skipIf` / `.failing` (dropped),
 * tagged-template tables (`test.each`…``), and titles built by calls.
 *
 * Coverage is decided per test block, per command. A test block is
 * NEGATIVE when it shows a negative outcome:
 * - an unambiguous keyword (STRONG_NEGATIVE_RE: `denied`, `forbidden`,
 *   `unauthorized` / `unauthorised`, `rate limited`, `quota exceeded`,
 *   `expired`, `rejected`) as a whole word in the test title or an
 *   enclosing describe title;
 * - a test-title keyword (TEST_TITLE_NEGATIVE_RE: the above plus
 *   `wrong scope`, `out of scope`, `rate limit(s)`) in the test's OWN title;
 * - the bare `quota` / `conflict(s)` only in the test's own title AND
 *   alongside a negative assertion in that test (#1507 review 4:
 *   'shows quota usage' or a describe('conflict resolution') are not
 *   negative outcomes); or
 * - a negative ASSERTION in the body: an assertion call (`expect(…)` with
 *   its whole matcher chain, or any `expect*` / `assert*` helper call)
 *   that contains a string literal which is exactly an error code
 *   (`'FORBIDDEN'`, `'RATE_LIMITED'`, `'QUOTA_EXCEEDED'`,
 *   `'APPROVAL_EXPIRED'`, `'conflict'`, …) or an HTTP 403 / 409 / 429.
 * A negative block covers ONLY the command ids (whole tokens) that appear
 * (#1507 review 3):
 * - in the test title or an enclosing describe title, or as an exact
 *   string literal in the test's (or an enclosing describe's) `.each` table, or
 * - inside the negative assertion call itself
 *   (`await expect(run('tasks.delete')).rejects.toMatchObject({ code: 'FORBIDDEN' })`).
 * An id elsewhere in the body (a setup call such as `run('tasks.create')`,
 * or `const r = run(id)` asserted in a later statement) does not count, and
 * a code or status outside an assertion (a mocked response fixture such as
 * `{ status: 403 }`) is not a negative outcome. Identifiers such as
 * `resolveConflict`, `quotaBytes` or `notExpired` never count.
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
import { CATALOGUE_PATH, COMMAND_ALLOWLIST_PATH, COMMAND_ID_RE, commandGateResult, loadCatalogue, matchBracket, stripJsComments, type CatalogueInputs } from './catalogue.ts'
import { resolveAllowlist, type AllowlistInputs } from './allowlist.ts'

export { CATALOGUE_PATH }

/** Unambiguous whole-word keywords: count in the test title or any enclosing describe title. */
export const STRONG_NEGATIVE_RE =
  /\b(?:permission[ _-]denied|denied|forbidden|unauthori[sz]ed|rate[ _-]?limited|quota[ _-]exceeded|expired|rejected)\b/i
/** Count in the test's OWN title only: the unambiguous ones plus scope / rate-limit wording. */
export const TEST_TITLE_NEGATIVE_RE =
  /\b(?:permission[ _-]denied|denied|forbidden|unauthori[sz]ed|rate[ _-]?limit(?:ed|s)?|quota[ _-]exceeded|expired|rejected|wrong[ _-]scope|out[ _-]of[ _-]scope)\b/i
/*
 * The bare `quota` / `conflict(s)` are ambiguous ('shows quota usage',
 * 'conflict-free merge', describe('conflict resolution')) and are in neither
 * list: they never make a test negative by themselves. A test with a negative
 * assertion is negative anyway, and then an id in its own title counts — that
 * is the only way such a title counts (#1507 review 4).
 */

/** Shown in the gate failure message and the README (keep in sync). */
export const TEST_SHAPES_HELP =
  "supported shapes: test/it(title, fn) inside describe(title, fn); test.each/it.each/describe.each(table)(title, fn) (literal ids in the table and the title count); " +
  "ids must be literal in a title, an .each table or the negative assertion (loops with computed titles do not count); " +
  "negative = denied/forbidden/unauthorized/rate limited/quota exceeded/expired/rejected in a test or describe title, wrong scope/out of scope/rate limit in the test's own title, " +
  "or an expect/assert call with an error-code literal or 403/409/429 (bare quota/conflict only count in the test's own title next to such an assertion); see packages/test-harness/README.md"

/** Error-code tokens that count when they appear as an exact string literal in a test body. */
export const NEGATIVE_CODE_TOKENS = [
  'FORBIDDEN', 'PERMISSION_DENIED', 'WRONG_SCOPE', 'SCOPE_MISMATCH', 'RATE_LIMITED', 'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED', 'CONFLICT', 'APPROVAL_EXPIRED', 'EXPIRED',
  'forbidden', 'permission_denied', 'wrong_scope', 'rate_limited', 'quota_exceeded', 'conflict', 'approval_expired', 'expired',
] as const

const CODE_LITERAL_RE = new RegExp(`(['"\`])(?:${NEGATIVE_CODE_TOKENS.join('|')})\\1`)
/** Inside an assertion call only (see assertionSpans). */
const HTTP_STATUS_RE = /(?<![\w.])(?:403|409|429)(?![\w.])/

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

interface Block {
  start: number
  end: number
  kind: 'describe' | 'test'
  text: string
  title: string
  body: string
  /** `.each(table)` only: string literals in the table that are exactly a command id (count as titles). */
  tableIds: string[]
}

const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g

/** String literals in an `.each` table that are exactly a dotted command id. */
function literalIds(table: string): string[] {
  const ids: string[] = []
  for (const m of table.matchAll(STRING_LITERAL_RE)) {
    const value = m[2] ?? ''
    if (COMMAND_ID_RE.test(value)) ids.push(value)
  }
  return ids
}

/**
 * describe / test / it blocks with their source text; skipped and todo tests
 * are dropped. `X.each(table)(title, fn)` is one block (see TEST_SHAPES_HELP).
 */
export function testBlocks(source: string): Block[] {
  const text = stripJsComments(source)
  const blocks: Block[] = []
  const re = /\b(describe|test|it)((?:\.[A-Za-z]+)*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const firstOpen = m.index + m[0].length - 1
    const firstClose = matchBracket(text, firstOpen)
    if (firstClose === -1) continue
    const modifiers = m[2] ?? ''
    if (/\.(?:skip|todo|skipIf|failing)\b/.test(modifiers)) continue
    let open = firstOpen
    let close = firstClose
    let tableIds: string[] = []
    if (/\.each\b/.test(modifiers)) {
      // `.each(table)(title, fn)`: the block is the second call; the table supplies literal ids.
      const call = /^\s*\(/.exec(text.slice(firstClose + 1))
      if (!call) continue
      open = firstClose + call[0].length
      close = matchBracket(text, open)
      if (close === -1) continue
      tableIds = literalIds(text.slice(firstOpen + 1, firstClose))
    }
    const inner = text.slice(open + 1, close)
    const titleMatch = /^\s*(['"`])([\s\S]*?)\1/.exec(inner)
    blocks.push({
      start: firstOpen,
      end: close,
      kind: m[1] === 'describe' ? 'describe' : 'test',
      text: inner,
      title: titleMatch?.[2] ?? '',
      body: titleMatch ? inner.slice(titleMatch.index + titleMatch[0].length) : inner,
      tableIds,
    })
  }
  return blocks
}

function tokenRe(id: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_.])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i')
}

const ASSERTION_START_RE = /(?<![\w$.])(?:expect|assert)\w*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/g

/**
 * Source text of every assertion call in `body`: `expect(…)` (or an
 * `expect*` / `assert*` helper, `assert.equal(…)` included) plus its chained
 * members and calls (`.not`, `.rejects`, `.toBe(…)`, …).
 */
export function assertionSpans(body: string): string[] {
  const spans: string[] = []
  ASSERTION_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ASSERTION_START_RE.exec(body)) !== null) {
    let end = matchBracket(body, m.index + m[0].length - 1)
    if (end === -1) continue
    for (;;) {
      const chain = /^\s*\??\.\s*[A-Za-z_$][\w$]*\s*/.exec(body.slice(end + 1))
      if (!chain) break
      end += chain[0].length
      if (body[end + 1] === '(') {
        const close = matchBracket(body, end + 1)
        if (close === -1) break
        end = close
      }
    }
    spans.push(body.slice(m.index, end + 1))
    ASSERTION_START_RE.lastIndex = end + 1
  }
  return spans
}

/** An assertion that checks a negative outcome (exact error-code literal or 403/409/429). */
export function isNegativeAssertion(span: string): boolean {
  return CODE_LITERAL_RE.test(span) || HTTP_STATUS_RE.test(span)
}

/**
 * True when a test shows a negative outcome (#1507 review 4 keyword rules):
 * `describeTitles` = enclosing describe titles, `ownTitle` = the test's title.
 */
export function isNegativeBlock(describeTitles: string, ownTitle: string, body: string): boolean {
  // bare quota / conflict add nothing here on purpose (see the note above TEST_SHAPES_HELP).
  return STRONG_NEGATIVE_RE.test(describeTitles) || TEST_TITLE_NEGATIVE_RE.test(ownTitle) || assertionSpans(body).some(isNegativeAssertion)
}

/** Negative-test coverage per command id within one test source (see the header for the rule). */
export function coveredCommands(source: string, ids: string[]): Set<string> {
  const blocks = testBlocks(source)
  const describes = blocks.filter((b) => b.kind === 'describe')
  const covered = new Set<string>()
  for (const t of blocks.filter((b) => b.kind === 'test')) {
    const enclosing = describes.filter((d) => d.start < t.start && d.end > t.end)
    const describeTitles = enclosing.map((d) => d.title).join('\n')
    if (!isNegativeBlock(describeTitles, t.title, t.body)) continue
    const negativeAssertions = assertionSpans(t.body).filter(isNegativeAssertion)
    // Titles for id matching: describe + own titles, plus literal ids from `.each` tables (own and enclosing).
    const titles = [describeTitles, t.title, ...enclosing.flatMap((d) => d.tableIds), ...t.tableIds].join('\n')
    for (const id of ids) {
      const re = tokenRe(id)
      if (re.test(titles) || negativeAssertions.some((span) => re.test(span))) covered.add(id)
    }
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
    hint: TEST_SHAPES_HELP,
  })
}
