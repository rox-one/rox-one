/**
 * W1-10 (#1507) — provenance check core.
 *
 * Shared by `scripts/check-provenance.ts`. Three rules (TECH-SPEC §6.1):
 * 1. source files that say they are derived from Operately ("adapted /
 *    ported / copied / derived / based on … Operately", or that cite the
 *    `operately/operately` repo) must carry the per-file provenance header.
 *    A plain mention of the name (e.g. "the unified Lark + Operately
 *    programme") is not a derivation claim and passes;
 * 2. nothing may declare an Enterprise-Edition source path (it is
 *    never reused) — every file type, no exclusions;
 * 3. source files must not carry a GPL/AGPL licence: an SPDX identifier
 *    (`SPDX-License-Identifier: GPL-3.0-only`, `AGPL-3.0-or-later`, …) or a
 *    licence header ("GNU General Public License", "GNU Affero General
 *    Public License"). Docs, NOTICE files and JSON inventories that merely
 *    mention AGPL are not source and pass; the bare word "AGPL" never fails.
 *
 * The function is pure over explicit `{ path, content }` inputs so it is
 * unit-testable. The on-disk scope (branch-changed files, self-path and
 * `*.test.ts` exclusions for literal-pattern rules) is decided by the
 * calling script — see `scripts/check-provenance.ts`.
 */

export interface ProvenanceFile {
  path: string
  content: string
}

export interface ProvenanceOptions {
  /** Extra path prefixes to skip for the literal-pattern rules. */
  excludePrefixes?: string[]
}

export const PROVENANCE_HEADER_RE = /Portions adapted from Operately/i
// NOTE: the forbidden Enterprise-Edition source literal is assembled from
// parts so this detector's own sources do not trip the declaration rule.
// The assembled pattern still matches the contiguous text in scanned files.
const EE_PATH = `operately${'/'}app/ee`
export const EE_SOURCE_RE = new RegExp(`Source:\\s*${EE_PATH}`, 'i')

/** Claims of derivation from Operately (not mere mentions of the name). */
export const OPERATELY_DERIVATION_RE =
  /\b(?:adapted|ported|copied|derived|taken|lifted|borrowed|based)\s+(?:on|from)\s+(?:the\s+)?operately\b|\bgithub\.com\/operately\b|\boperately\/operately\b|\bSource:\s*operately\//i

/** GPL-family licence markers: SPDX identifiers or licence-header text (not LGPL). */
export const GPL_LICENSE_RE =
  /SPDX-License-Identifier:[^\n]*\bA?GPL-\d|GNU\s+(?:Affero\s+)?General\s+Public\s+License/i

/** File extensions treated as source code for rules 1 and 3. */
export const SOURCE_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'css', 'scss', 'less', 'html',
  'rs', 'go', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'ex', 'exs', 'erl', 'lua', 'dart',
  'sh', 'bash', 'zsh', 'ps1', 'sql',
] as const

const SOURCE_EXTENSION_SET = new Set<string>(SOURCE_EXTENSIONS)

export function isSourceFile(path: string): boolean {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return SOURCE_EXTENSION_SET.has(name.slice(dot + 1).toLowerCase())
}

/**
 * Base ref for the branch diff: `ROX_PROVENANCE_BASE` (explicit override),
 * else `origin/<GITHUB_BASE_REF>` on pull requests, else `origin/main`.
 */
export function resolveProvenanceBase(env: Record<string, string | undefined> = process.env): string {
  const override = env.ROX_PROVENANCE_BASE?.trim()
  if (override) return override
  const prBase = env.GITHUB_BASE_REF?.trim()
  if (prBase) return `origin/${prBase}`
  return 'origin/main'
}

function excluded(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p))
}

export function checkProvenanceFiles(files: ProvenanceFile[], opts: ProvenanceOptions = {}): string[] {
  const prefixes = opts.excludePrefixes ?? []
  const violations: string[] = []
  for (const { path, content } of files) {
    if (EE_SOURCE_RE.test(content)) {
      violations.push(`${path}: declares an Enterprise-Edition source (${EE_PATH}); it must never be reused`)
      continue
    }
    if (excluded(path, prefixes) || !isSourceFile(path)) continue
    if (OPERATELY_DERIVATION_RE.test(content) && !PROVENANCE_HEADER_RE.test(content)) {
      violations.push(`${path}: derived from Operately without the per-file provenance header (TECH-SPEC §6.1)`)
    }
    if (GPL_LICENSE_RE.test(content)) {
      violations.push(`${path}: carries a GPL/AGPL licence header or SPDX identifier`)
    }
  }
  return violations
}
