/**
 * W1-10 (#1507) — negative-test presence gate (PLAN §1.4 v2 definition of done).
 *
 * Every command defined under `packages/core/src/commands/catalogue/*`
 * (#1500) needs its own negative test: permission denied, wrong scope,
 * rate limited, quota exceeded, conflict, expired approval.
 *
 * Coverage is decided per test block, per command: a `test(…)` / `it(…)`
 * call (not `.skip` / `.todo`) whose text — or an enclosing `describe(…)`
 * title — names the command id as a whole token AND contains a negative
 * keyword. A file that merely mentions the id somewhere and a keyword
 * somewhere else no longer counts.
 *
 * Walk: only test files (`*.test.ts(x)`, `*.spec.ts(x)`) under the test
 * roots (`packages`, `apps/workspace-service`, `tests`, `e2e` by default),
 * skipping node_modules / .git / dist / build / coverage / resources and
 * never following symlinks. Catalogue absent → pending.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { CATALOGUE_PATH, matchBracket, readCatalogue, stripJsComments } from './catalogue.ts'

export const NEGATIVE_KEYWORDS = [
  'permission denied',
  'permission_denied',
  'denied',
  'forbidden',
  'wrong scope',
  'rate limit',
  'rate_limit',
  'rate-limited',
  'quota',
  'conflict',
  'expired',
] as const

export const DEFAULT_TEST_ROOTS = ['packages', join('apps', 'workspace-service'), 'tests', 'e2e'] as const
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', 'resources', '.turbo', '.cache'])
const TEST_FILE_RE = /\.(?:test|spec)\.tsx?$/

/** Command ids found in a catalogue directory (one per definition). */
export function commandNamesInCatalogue(catalogueDir: string): string[] {
  return readCatalogue(catalogueDir).commands.map((c) => c.id)
}

export function collectTestFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = lstatSync(full)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) collectTestFiles(full, out)
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

/** Negative-test coverage per command id within one test source. */
export function coveredCommands(source: string, ids: string[]): Set<string> {
  const blocks = testBlocks(source)
  const describes = blocks.filter((b) => b.kind === 'describe')
  const covered = new Set<string>()
  for (const t of blocks.filter((b) => b.kind === 'test')) {
    const context = describes.filter((d) => d.start < t.start && d.end > t.end).map((d) => d.title).join(' ')
    const haystack = `${context}\n${t.text}`
    const lower = haystack.toLowerCase()
    if (!NEGATIVE_KEYWORDS.some((k) => lower.includes(k))) continue
    for (const id of ids) if (tokenRe(id).test(haystack)) covered.add(id)
  }
  return covered
}

export function checkNegativeTestPresence(opts: {
  repoRoot?: string
  catalogueDir?: string
  testRoots?: string[]
} = {}): GateResult {
  const gate = 'negative-tests'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const catalogue = readCatalogue(opts.catalogueDir ?? join(root, CATALOGUE_PATH))
  if (!catalogue.present) return pending(gate, `${CATALOGUE_PATH}/*`, '1500')

  const ids = [...new Set(catalogue.commands.map((c) => c.id))]
  const testFiles: string[] = []
  for (const r of opts.testRoots ?? DEFAULT_TEST_ROOTS.map((p) => join(root, p))) collectTestFiles(r, testFiles)
  const covered = new Set<string>()
  for (const f of testFiles) {
    let src: string
    try {
      src = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const id of coveredCommands(src, ids)) covered.add(id)
  }
  const violations = [...catalogue.problems]
  for (const id of ids) {
    if (!covered.has(id)) violations.push(`command '${id}' has no negative test block (permission/scope/rate-limit/quota/conflict/expiry)`)
  }
  return gateFromViolations(gate, violations, `${ids.length} command(s) have negative tests`)
}
