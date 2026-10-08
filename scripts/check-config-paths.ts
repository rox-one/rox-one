#!/usr/bin/env bun
/**
 * W1-13 (#1510) CI grep gate: no new home-rooted `.rox` paths, no new
 * `~/Documents` / `~/Desktop` defaults (TECH-SPEC §10.1 rule 3, PLAN §1.4).
 *
 * Pattern-based (siblings adding `<workspaceRoot>/.rox` stores need no edits):
 * - FORBIDDEN: a `.rox` path built from a home base — `~/.rox`, `$HOME/.rox`,
 *   `join(homedir()/homeDir/HOME…, '.rox')`, `ROX_CONFIG_DIR:-$HOME/.rox` —
 *   and new `~/Documents` / `~/Desktop` defaults in code/shell.
 * - ALLOWED: workspace-relative `join(<workspaceRoot|root|ws…>, '.rox', …)`
 *   (D-v2-11), the migrator + manifest, `*.legacy-dot-rox.*` fixtures, tests,
 *   and explicit exemptions below (each with a reason).
 *
 * Usage:
 *   bun run scripts/check-config-paths.ts            # scan repo, exit 1 on violations
 *   bun run scripts/check-config-paths.ts --self-test # fixture check (also in .test.ts)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface GateViolation {
  file: string
  line: number
  text: string
  reason: string
}

interface FileExempt {
  file: string
  reason: string
  /** When set, only lines matching one pattern are exempt in this file. */
  lineMustMatch?: string[]
  /** When true, `file` is a directory prefix covering a vendored tree. */
  dirPrefix?: boolean
}

// Explicit exemptions — each with a reason. Prefer pattern rules over adding
// entries here; sibling packages must not need allowlist edits for new
// `<workspaceRoot>/.rox` stores (those are pattern-allowed).
const FILE_EXEMPTS: FileExempt[] = [
  { file: 'packages/shared/src/identity/manifest.ts', reason: 'defines ROX_HOME_DIR_NAME / ROX_COMPAT_SYMLINK_NAME' },
  { file: 'packages/shared/src/identity/config-migration.ts', reason: 'the MIG-13 migrator itself' },
  { file: 'scripts/check-config-paths.ts', reason: 'the gate (patterns quoted in source)' },
  { file: 'scripts/codemods/rox-home.ts', reason: 'the codemod (patterns quoted in source)' },
  { file: 'scripts/codemods/rox-home.manifest.json', reason: 'the codemod manifest (from→to rules quote legacy patterns)' },
  {
    file: 'apps/electron/src/main/ssh-tunnel/server-bootstrap.ts',
    reason: 'legacy remote-home probe/move + compat symlink (read-only, never deleted)',
    lineMustMatch: ['LEGACY', 'legacy', 'REMOTE_HOME_MOVE', 'REMOTE_INSTALL_PROBE', 'mv ', 'ln -s', 'test -[de] ~', 'craft-agent', 'MARKER', '§10.4'],
  },
  {
    file: 'apps/electron/src/main/ssh-tunnel/ssh-tunnel-manager.ts',
    reason: 'legacy remote token fallback candidates (read-only, never written)',
    lineMustMatch: ['~/rox', '~/.rox/', '~/.craft-agent', 'token', '.env', 'Legacy', 'legacy', 'fallback', 'probe'],
  },
  { file: 'apps/electron/resources/skills/', reason: 'bundled skill content (owned by skill authors incl. vendored scripts; not Rox storage)', dirPrefix: true },
  { file: 'docs/plans/2026-10-07-rox-visible-config-migration.md', reason: 'the migration policy doc (intentional legacy-path narrative, W1-13 note)' },
  { file: 'plans/identity-migration-plan.md', reason: 'dated migration plan (historical evidence)' },
  { file: 'apps/electron/resources/docs/sources.md', reason: 'user-docs connection examples (pre-existing ~/Documents samples, not Rox defaults)' },
  { file: 'apps/electron/resources/skills/', reason: 'bundled third-party skill content (owned by skill authors, not Rox storage)', dirPrefix: true },
  { file: 'apps/electron/src/renderer/playground/', reason: 'storybook-style mock data (not real paths)', dirPrefix: true },
]

// Test/fixture scopes are exempt: legacy expectations pin flag-OFF behavior,
// `*.legacy-dot-rox.*` keeps explicit legacy cases (TECH-SPEC §10.2).
function isTestScope(relativePath: string): boolean {
  return (
    relativePath.includes('__tests__/') ||
    relativePath.endsWith('.test.ts') ||
    relativePath.endsWith('.seed.ts') ||
    relativePath.includes('.legacy-dot-rox.')
  )
}

// Frozen history comes from the codemod manifest (single source).
function frozenHistory(root: string): string[] {
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, 'scripts', 'codemods', 'rox-home.manifest.json'), 'utf8'),
    ) as { frozenHistory?: string[] }
    return manifest.frozenHistory ?? []
  } catch {
    return []
  }
}

// A `.rox` segment that is NOT `.rox-cloud` / `.roxXYZ`.
const DOT_ROX = /\.rox(?![-\w])/
const HOME_TILDE = /~\/\.rox(?![-\w])/
const HOME_VAR = /\$HOME\/\.rox(?![-\w])/
const HOME_JOIN = /(homedir|homeDir|HOME|process\.env\.HOME)\s*\(\s*\)?\s*,?\s*[^)\n]*['"]\.rox(?![-\w])['"]|join\s*\([^)\n]*(homedir|homeDir|\bhome\b|HOME)[^)\n]*['"]\.rox(?![-\w])['"]/
const SHELL_DEFAULT = /ROX_CONFIG_DIR:-\$HOME\/\.rox(?![-\w])/
const DOCS_DESKTOP = /~\/Documents|~\/Desktop|\$HOME\/Documents|\$HOME\/Desktop/
const CODE_DOCS_DESKTOP = /(homedir|homeDir|\bhome\b|HOME)\s*\(\s*\)?\s*,?\s*[^)\n]*['"]\.?(Documents|Desktop)['"]|join\s*\([^)\n]*(homedir|homeDir|\bhome\b|HOME)[^)\n]*['"]\.?(Documents|Desktop)['"]/

const WORKSPACE_BASE = /(workspaceRoot|workspace|workspacePath|wsRoot|ws\b|root|rootPath|dir|folder)/

// Line markers that bless an otherwise home-rooted mention (compat narrative,
// never a new store): legacy/compat/migration/symlink vocabulary.
const COMPAT_WORDS = /(legacy|compat|migrat|symlink|junction|revert|workbench-flags|legacy-dot-rox|craft-agent|remote-server|\.token|\.env\b)/i

function stripTsComments(source: string): string {
  // Grep-grade comment stripping (documented limitation: exotic nesting aside,
  // string contents that LOOK like comments are preserved by scanning quotes).
  let out = ''
  let i = 0
  let quote: string | null = null
  let templateDepth = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote && templateDepth === 0) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      out += '\n'
      i = end === -1 ? source.length : end + 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const skipped = end === -1 ? source.slice(i) : source.slice(i, end + 2)
      // Preserve newlines so stripped output stays line-aligned with source.
      for (const nl of skipped.match(/\n/g) ?? []) out += nl
      i = end === -1 ? source.length : end + 2
      continue
    }
    out += ch
    i++
  }
  return out
}

export function checkLine(relativePath: string, line: string, codeLine: string): GateViolation[] {
  const violations: GateViolation[] = []
  const isTs = /\.tsx?$/.test(relativePath)
  // Prose mentions in comments are narrative; code tokens build paths.
  const haystack = isTs ? codeLine : line
  if (!/\.rox|Documents|Desktop/.test(haystack)) return violations
  if (!DOT_ROX.test(haystack) && !DOCS_DESKTOP.test(haystack) && !CODE_DOCS_DESKTOP.test(haystack)) {
    return violations
  }

  const homeRooted =
    HOME_TILDE.test(haystack) ||
    HOME_VAR.test(haystack) ||
    HOME_JOIN.test(haystack) ||
    SHELL_DEFAULT.test(haystack) ||
    (/['"]\.rox(?![-\w])['"]/.test(haystack) && !WORKSPACE_BASE.test(haystack))
  if (homeRooted && !COMPAT_WORDS.test(line)) {
    violations.push({
      file: relativePath,
      line: 0,
      text: line.trim(),
      reason: 'home-rooted .rox path (use resolveConfigDir()/getConfigPaths() or a ~/rox literal)',
    })
  }
  const desktopHit = isTs ? CODE_DOCS_DESKTOP.test(haystack) || (DOCS_DESKTOP.test(haystack) && !COMPAT_WORDS.test(line)) : DOCS_DESKTOP.test(haystack)
  if (desktopHit && !COMPAT_WORDS.test(line)) {
    violations.push({
      file: relativePath,
      line: 0,
      text: line.trim(),
      reason: 'new ~/Documents or ~/Desktop default (PLAN §1.4: user files live under ~/rox)',
    })
  }
  return violations
}

export function checkFile(root: string, relativePath: string, frozen: string[]): GateViolation[] {
  if (isTestScope(relativePath)) return []
  if (frozen.includes(relativePath)) return []
  const exempt = FILE_EXEMPTS.find((e) => (e.dirPrefix ? relativePath.startsWith(e.file) : e.file === relativePath))
  const full = join(root, relativePath)
  let source: string
  try {
    source = readFileSync(full, 'utf8')
  } catch {
    return []
  }
  const isTs = /\.tsx?$/.test(relativePath)
  const code = isTs ? stripTsComments(source) : source
  const lines = source.split('\n')
  const codeLines = code.split('\n')
  const violations: GateViolation[] = []
  lines.forEach((line, index) => {
    // Keep line alignment: comment stripping preserves newlines.
    const found = checkLine(relativePath, line, codeLines[index] ?? '')
    for (const violation of found) {
      if (exempt?.lineMustMatch && !exempt.lineMustMatch.some((pattern) => line.includes(pattern))) {
        violations.push({ ...violation, line: index + 1 })
      } else if (!exempt) {
        violations.push({ ...violation, line: index + 1 })
      }
    }
  })
  return violations
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo'])

export function scanTree(root: string): GateViolation[] {
  const frozen = frozenHistory(root)
  const violations: GateViolation[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.codegraph')) continue
      const full = join(dir, name)
      const rel = relative(root, full)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        walk(full)
      } else if (stat.isFile()) {
        if (name === 'bun.lock' || name === 'bun.lockb' || /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|node|sqlite|db)$/.test(name)) {
          continue
        }
        violations.push(...checkFile(root, rel, frozen))
      }
    }
  }
  walk(root)
  return violations.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) {
    const failures = selfTest()
    if (failures.length > 0) {
      for (const failure of failures) console.log(`self-test FAIL: ${failure}`)
      process.exit(1)
    }
    console.log('check-config-paths self-test: all fixtures behave as expected')
    return
  }
  const root = resolve(join(import.meta.dir, '..'))
  const violations = scanTree(root)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.log(`${violation.file}:${violation.line}: ${violation.reason}\n  ${violation.text}`)
    }
    console.log(`${violations.length} forbidden config path(s) — see TECH-SPEC §10.1 rule 3`)
    process.exit(1)
  }
  console.log('config paths clean: no home-rooted .rox, no ~/Documents/~/Desktop defaults')
}

/**
 * Fixture self-test (also covered by `check-config-paths.test.ts`):
 * proves the gate fails on a planted `homedir(), '.rox'` and passes
 * workspace-relative `.rox`.
 */
export function selfTest(): string[] {
  const failures: string[] = []
  const expectViolations = (file: string, line: string, codeLine: string, want: boolean): void => {
    const found = checkLine(file, line, codeLine).length > 0
    if (found !== want) {
      failures.push(`${file}: ${want ? 'expected a violation for' : 'unexpected violation for'} ${JSON.stringify(line)}`)
    }
  }
  // Planted offender: must fail.
  expectViolations('src/a.ts', "export const p = join(homedir(), '.rox', 'x.json')", "export const p = join(homedir(), '.rox', 'x.json')", true)
  expectViolations('src/b.sh', 'dir="$HOME/.rox"', 'dir="$HOME/.rox"', true)
  expectViolations('docs/c.md', 'data lives in ~/.rox/data', 'data lives in ~/.rox/data', true)
  expectViolations('src/d.ts', "join(homeDir, '.rox', 'x')", "join(homeDir, '.rox', 'x')", true)
  // Workspace-relative: must pass (pattern-based, no allowlist edits).
  expectViolations('src/e.ts', "join(workspaceRoot, '.rox', 'x.json')", "join(workspaceRoot, '.rox', 'x.json')", false)
  expectViolations('src/f.ts', "join(root, '.rox', 'browser-data-auto-import.json')", "join(root, '.rox', 'browser-data-auto-import.json')", false)
  // Compat narrative: must pass.
  expectViolations('src/g.sh', 'TOKEN="~/.rox/remote-server/.token" # LEGACY fallback', 'TOKEN="~/.rox/remote-server/.token" # LEGACY fallback', false)
  expectViolations('src/h.ts', "export const LEGACY_ROX_REMOTE_INSTALL_DIR = '~/.rox/remote-server'", "export const LEGACY_ROX_REMOTE_INSTALL_DIR = '~/.rox/remote-server'", false)
  // Comment-stripped prose: must pass in TS.
  expectViolations('src/i.ts', '// reads ~/.rox for legacy profiles', '', false)
  // ~/rox itself is always fine.
  expectViolations('src/j.ts', "join(homeDir, 'rox', 'x')", "join(homeDir, 'rox', 'x')", false)
  // New Documents/Desktop defaults: must fail.
  expectViolations('src/k.ts', "join(homedir(), 'Documents', 'x')", "join(homedir(), 'Documents', 'x')", true)
  return failures
}

await main()
