#!/usr/bin/env bun
/**
 * W1-10 (#1507) — provenance gate (TECH-SPEC §6.1).
 *
 * Fails when branch files:
 * - declare an Enterprise-Edition source path (never reused — see TECH-SPEC §6.1);
 * - mention Operately in TS/TSX without the per-file provenance header;
 * - carry a GPL/AGPL licence header or SPDX identifier in a source file.
 *
 * Scope: files changed on this branch vs the merge-base with the base
 * branch, plus untracked files. The base is `ROX_PROVENANCE_BASE` when set,
 * else `origin/$GITHUB_BASE_REF` on pull requests, else `origin/main`
 * (see `resolveProvenanceBase`). The CI job checks out with
 * `fetch-depth: 0` so the base and the merge-base exist.
 *
 * Fail closed: an unresolvable base, a missing merge-base or any failing
 * git command exits 1. It never reports a vacuous "0 files scanned" pass
 * because git could not answer.
 *
 * Literal-pattern rules skip the gate's own implementation
 * (`packages/test-harness/`, this script) and `*.test.ts` files, whose
 * in-memory fixtures simulate violations without shipping them. The
 * Enterprise-Edition declaration rule applies to every file, no exceptions.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkProvenanceFiles, resolveProvenanceBase } from '../packages/test-harness/src/gates/provenance.ts'

const ROOT = join(import.meta.dir, '..')
const BASE = resolveProvenanceBase(process.env)

function fail(message: string): never {
  console.error(`provenance check failed: ${message}`)
  process.exit(1)
}

function git(args: string[]): string {
  const proc = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim()
    fail(`git ${args.join(' ')} exited ${proc.exitCode}${stderr ? `: ${stderr}` : ''}`)
  }
  return proc.stdout.toString()
}

function lines(output: string): string[] {
  return output.split('\n').map((l) => l.trim()).filter(Boolean)
}

function changedFiles(): string[] {
  const baseCommit = git(['rev-parse', '--verify', '--quiet', `${BASE}^{commit}`]).trim()
  if (!baseCommit) fail(`base ${BASE} does not resolve (fetch it, or set ROX_PROVENANCE_BASE)`)
  const mergeBase = git(['merge-base', 'HEAD', baseCommit]).trim()
  if (!/^[0-9a-f]{40,64}$/.test(mergeBase)) fail(`no merge-base between HEAD and ${BASE}`)
  const tracked = lines(git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, 'HEAD']))
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('~/'))
}

const SELF_PREFIXES = ['packages/test-harness/', 'scripts/check-provenance.ts']

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx')
}

const files = changedFiles()
  .filter((f) => existsSync(join(ROOT, f)))
  .map((path) => {
    try {
      return { path, content: readFileSync(join(ROOT, path), 'utf8') }
    } catch (error) {
      return fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

// The ee-declaration rule has no exclusions; literal rules skip the gate
// itself and test files (see the header comment).
const violations = checkProvenanceFiles(files, {
  excludePrefixes: [...SELF_PREFIXES, ...files.filter((f) => isTestFile(f.path)).map((f) => f.path)],
})

if (violations.length > 0) {
  console.error(`provenance check failed (base ${BASE}):`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`provenance check passed (${files.length} branch file(s) scanned vs ${BASE})`)
