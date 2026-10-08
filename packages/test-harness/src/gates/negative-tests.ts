/**
 * W1-10 (#1507) — negative-test presence gate (PLAN §1.4 v2 definition of done).
 *
 * Every command defined under `packages/core/src/commands/catalogue/*`
 * (#1500) must have negative tests: permission denied, wrong scope, rate
 * limited, quota exceeded, conflict, expired approval. Presence is detected
 * per command name: a `*.test.ts` file under the repo that mentions the
 * command name together with at least one negative keyword. Missing
 * catalogue → pending.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { CATALOGUE_PATH } from './risk-class.ts'

export const NEGATIVE_KEYWORDS = [
  'permission denied',
  'permission_denied',
  'denied',
  'wrong scope',
  'rate limit',
  'rate_limit',
  'rate-limited',
  'quota',
  'conflict',
  'expired',
] as const

export function commandNamesInCatalogue(catalogueDir: string): string[] {
  const names: string[] = []
  for (const file of readdirSync(catalogueDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = readFileSync(join(catalogueDir, file), 'utf8')
    const m = /name\s*:\s*['"`]([^'"`]+)['"`]/.exec(src)
    names.push(m ? m[1] : file.replace(/\.ts$/, ''))
  }
  return names
}

function collectTestFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) collectTestFiles(full, out)
    else if (/\.test\.ts$/.test(entry)) out.push(full)
  }
}

export function checkNegativeTestPresence(opts: {
  repoRoot?: string
  catalogueDir?: string
  testRoots?: string[]
} = {}): GateResult {
  const gate = 'negative-tests'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const catalogueDir = opts.catalogueDir ?? join(root, CATALOGUE_PATH)
  if (!existsSync(catalogueDir) || !statSync(catalogueDir).isDirectory()) {
    return pending(gate, `${CATALOGUE_PATH}/*`, '1500')
  }
  const names = commandNamesInCatalogue(catalogueDir)
  if (names.length === 0) return pending(gate, `${CATALOGUE_PATH}/*`, '1500')

  const roots = opts.testRoots ?? [root]
  const testFiles: string[] = []
  for (const r of roots) collectTestFiles(r, testFiles)
  const haystacks = new Map<string, string>()
  for (const f of testFiles) {
    try {
      haystacks.set(f, readFileSync(f, 'utf8').toLowerCase())
    } catch {
      // unreadable — skip
    }
  }
  const violations: string[] = []
  for (const name of names) {
    const needle = name.toLowerCase()
    const covered = [...haystacks.values()].some(
      (src) => src.includes(needle) && NEGATIVE_KEYWORDS.some((k) => src.includes(k)),
    )
    if (!covered) violations.push(`command '${name}' has no negative test (permission/scope/rate-limit/quota/conflict/expiry)`)
  }
  return gateFromViolations(gate, violations, `${names.length} command(s) have negative tests`)
}
