#!/usr/bin/env bun
/**
 * W1-10 (#1507) — provenance gate (TECH-SPEC §6.1).
 *
 * Fails when branch files:
 * - declare an Enterprise-Edition source path (never reused — see TECH-SPEC §6.1);
 * - mention Operately in TS/TSX without the per-file provenance header;
 * - contain GPL/AGPL markers.
 *
 * Scope: files changed on this branch vs the merge-base with the base
 * branch, plus untracked files. Literal-pattern rules skip the gate's own
 * implementation (`packages/test-harness/`, this script) and `*.test.ts`
 * files, whose in-memory fixtures simulate violations without shipping
 * them. The Enterprise-Edition declaration rule applies to every file, no exceptions.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkProvenanceFiles } from '../packages/test-harness/src/gates/provenance.ts'

const ROOT = join(import.meta.dir, '..')
const BASE = process.env.ROX_PROVENANCE_BASE ?? 'origin/feat/w1-01-02-entity-registry-links'

function gitLines(args: string[]): string[] {
  const proc = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' })
  if (proc.exitCode !== 0) return []
  return proc.stdout.toString().split('\n').map((l) => l.trim()).filter(Boolean)
}

function changedFiles(): string[] {
  let base = BASE
  const mergeBase = Bun.spawnSync(['git', 'merge-base', 'HEAD', BASE], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' })
  if (mergeBase.exitCode === 0) base = mergeBase.stdout.toString().trim()
  const tracked = gitLines(['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD'])
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'])
  return [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('~/'))
}

const SELF_PREFIXES = ['packages/test-harness/', 'scripts/check-provenance.ts']

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx')
}

const files = changedFiles()
  .filter((f) => existsSync(join(ROOT, f)))
  .map((path) => {
    let content = ''
    try {
      content = readFileSync(join(ROOT, path), 'utf8')
    } catch {
      return null
    }
    return { path, content }
  })
  .filter((f): f is { path: string; content: string } => f !== null)

// The ee-declaration rule has no exclusions; literal rules skip the gate
// itself and test files (see the header comment).
const violations = checkProvenanceFiles(files, {
  excludePrefixes: [...SELF_PREFIXES, ...files.filter((f) => isTestFile(f.path)).map((f) => f.path)],
})

if (violations.length > 0) {
  console.error('provenance check failed:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`provenance check passed (${files.length} branch file(s) scanned)`)
