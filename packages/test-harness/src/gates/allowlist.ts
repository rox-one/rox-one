/**
 * W1-10 (#1507) — checked-in, shrink-only gate allowlists.
 *
 * Some gates accept a short list of known exceptions (owner decisions,
 * #1507 review 2): unpaired DDL tables (`ddl-zod-parity`) and command
 * exceptions (`risk-class`, `negative-tests`). The lists live in
 * `packages/test-harness/allowlists/*.json` and may only SHRINK:
 *
 * - a stale entry (the exception no longer applies: the table now pairs,
 *   the command now passes, or the id no longer exists) is a violation, so
 *   the entry must be deleted in the change that fixes it;
 * - an entry that is not in the same list at the merge-base with the base
 *   branch (see `resolveProvenanceBase`) is a violation: new exceptions are
 *   not accepted silently. When the list file does not exist at the
 *   merge-base (the change that introduces it), there is nothing to grow
 *   from and every entry is accepted.
 *
 * Fail closed: an unreadable / malformed list, or a base that git cannot
 * resolve, is a violation, never a silent pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { errorMessage } from './types.ts'
import { resolveProvenanceBase } from './provenance.ts'

export const ALLOWLIST_DIR = join('packages', 'test-harness', 'allowlists')

export type AllowlistRead = { ok: true; entries: string[] } | { ok: false; problem: string }

/** Parse one key of an allowlist JSON document: `{ "<key>": ["id", …] }`. */
export function parseAllowlist(text: string, key: string): AllowlistRead {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (error) {
    return { ok: false, problem: `not valid JSON: ${errorMessage(error)}` }
  }
  const list = (doc as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(list) || list.some((e) => typeof e !== 'string' || e.trim() === '')) {
    return { ok: false, problem: `"${key}" must be an array of non-empty strings` }
  }
  const entries = list as string[]
  const dupes = entries.filter((e, i) => entries.indexOf(e) !== i)
  if (dupes.length > 0) return { ok: false, problem: `"${key}" has duplicate entries: ${[...new Set(dupes)].join(', ')}` }
  return { ok: true, entries }
}

export function readAllowlist(root: string, relPath: string, key: string): AllowlistRead {
  const full = join(root, relPath)
  if (!existsSync(full)) return { ok: false, problem: 'missing (the gate needs its checked-in allowlist, even when empty)' }
  try {
    return parseAllowlist(readFileSync(full, 'utf8'), key)
  } catch (error) {
    return { ok: false, problem: `unreadable: ${errorMessage(error)}` }
  }
}

/** `null` = the list file does not exist at the merge-base (introduced by this change). */
export type BaseAllowlist = { ok: true; entries: string[] | null } | { ok: false; problem: string }

function git(root: string, args: string[]): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  return { code: proc.exitCode ?? 1, out: proc.stdout.toString(), err: proc.stderr.toString().trim() }
}

/** The same list at the merge-base of HEAD and the base branch. */
export function readBaseAllowlist(root: string, relPath: string, key: string, env: Record<string, string | undefined> = process.env): BaseAllowlist {
  const base = resolveProvenanceBase(env)
  const commit = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
  if (commit.code !== 0 || !commit.out.trim()) return { ok: false, problem: `base ${base} does not resolve (fetch it, or set ROX_PROVENANCE_BASE)` }
  const mb = git(root, ['merge-base', 'HEAD', commit.out.trim()])
  if (mb.code !== 0 || !mb.out.trim()) return { ok: false, problem: `no merge-base between HEAD and ${base}` }
  const gitPath = relPath.split('\\').join('/')
  const exists = git(root, ['cat-file', '-e', `${mb.out.trim()}:${gitPath}`])
  if (exists.code !== 0) return { ok: true, entries: null }
  const shown = git(root, ['show', `${mb.out.trim()}:${gitPath}`])
  if (shown.code !== 0) return { ok: false, problem: `git show ${gitPath} at the merge-base failed: ${shown.err}` }
  const parsed = parseAllowlist(shown.out, key)
  return parsed.ok ? { ok: true, entries: parsed.entries } : { ok: false, problem: `at the merge-base: ${parsed.problem}` }
}

/** Entries added since the merge-base. */
export function shrinkOnlyViolations(label: string, current: readonly string[], base: readonly string[] | null): string[] {
  if (base === null) return []
  const before = new Set(base)
  return current
    .filter((e) => !before.has(e))
    .map((e) => `${label}: '${e}' was added; the allowlist may only shrink (fix the exception instead)`)
}

/** Resolved allowlist for a gate run (current entries + growth violations). */
export interface AllowlistState {
  entries: string[]
  problems: string[]
}

export interface AllowlistInputs {
  /** Injected current entries (self-tests); default: read the checked-in file. */
  entries?: string[]
  /** Injected merge-base entries (`null` = file absent at base); default: read via git. */
  baseEntries?: string[] | null
}

export function resolveAllowlist(root: string, relPath: string, key: string, inputs: AllowlistInputs = {}, env: Record<string, string | undefined> = process.env): AllowlistState {
  const label = `${relPath.split('\\').join('/')}#${key}`
  let entries: string[]
  if (inputs.entries) entries = inputs.entries
  else {
    const read = readAllowlist(root, relPath, key)
    if (!read.ok) return { entries: [], problems: [`${label}: ${read.problem}`] }
    entries = read.entries
  }
  let base: string[] | null
  if (inputs.baseEntries !== undefined) base = inputs.baseEntries
  else {
    const read = readBaseAllowlist(root, relPath, key, env)
    if (!read.ok) return { entries, problems: [`${label}: cannot verify shrink-only: ${read.problem}`] }
    base = read.entries
  }
  return { entries, problems: shrinkOnlyViolations(label, entries, base) }
}
