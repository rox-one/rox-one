/**
 * W1-10 (#1507) — provenance check core.
 *
 * Shared by `scripts/check-provenance.ts`. Three rules (TECH-SPEC §6.1),
 * all scoped to SOURCE files (see `SOURCE_EXTENSIONS`); docs, NOTICE files
 * and JSON inventories are never checked, so specs may quote the rules:
 * 1. source files that say they are derived from Operately ("adapted /
 *    ported / copied / derived / based on … Operately", or that cite the
 *    `operately/operately` repo) must carry the per-file provenance header.
 *    A plain mention of the name (e.g. "the unified Lark + Operately
 *    programme") is not a derivation claim and passes;
 * 2. no source file may declare an Enterprise-Edition origin in a comment
 *    (provenance headers are comments). Detected forms: a `Source:` line
 *    naming the Operately EE tree, a §6.1-style `file:` line pointing into
 *    the EE app directory, and a GitHub blob / tree URL of the Operately
 *    repo pointing there (see `EE_DECLARATION_RES`). String literals and
 *    prose in docs are not declarations;
 * 3. source files must not carry a GPL/AGPL licence: an SPDX identifier
 *    (`SPDX-License-Identifier: GPL-3.0-only`, `AGPL-3.0-or-later`, …) or a
 *    licence header ("GNU General Public License", "GNU Affero General
 *    Public License"). The bare word "AGPL" never fails.
 *
 * The function is pure over explicit `{ path, content }` inputs so it is
 * unit-testable. The on-disk scope (branch-changed files, the exact
 * fixture files exempt from rules 1 and 3) is decided by the calling
 * script — see `scripts/check-provenance.ts`.
 */

export interface ProvenanceFile {
  path: string
  content: string
}

export interface ProvenanceOptions {
  /** Exact paths (or prefixes) exempt from rules 1 and 3 (the gate's own fixtures). Rule 2 has no exemptions. */
  excludePrefixes?: string[]
}

export const PROVENANCE_HEADER_RE = /Portions adapted from Operately/i
// NOTE: the forbidden Enterprise-Edition paths are assembled from parts so
// this detector's own sources (and its docs) never contain the contiguous
// text. The assembled patterns still match it in scanned files.
const EE_DIR = `app${'/'}ee`
const EE_PATH = `operately/${EE_DIR}`
/** EE declarations (rule 2): `Source:` line, §6.1 `file:` line, GitHub blob/tree URL. */
export const EE_DECLARATION_RES: readonly RegExp[] = [
  new RegExp(`Source:\\s*${EE_PATH}`, 'i'),
  new RegExp(`\\bfile:\\s*(?:operately/)?${EE_DIR}(?:/|\\b)`, 'i'),
  new RegExp(`operately/operately/(?:blob|tree)/[^/\\s]+/${EE_DIR}(?:/|\\b)`, 'i'),
]
/** Kept for callers of the previous API: the `Source:` form only. */
export const EE_SOURCE_RE = EE_DECLARATION_RES[0]!

/** Comment text of a source file (line comments, block / JSDoc lines, `#` and `--` comments). */
export function commentLines(content: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (inBlock) {
      out.push(t)
      if (t.includes('*/')) inBlock = false
      continue
    }
    if (t.startsWith('/*')) {
      out.push(t)
      if (!t.includes('*/')) inBlock = true
    } else if (/^(?:\/\/|#|--|<!--)/.test(t)) out.push(t)
    else {
      // Trailing `// …` comment after code (not the `//` of a URL scheme).
      const trailing = /(?:^|[^:/])\/\/(.*)$/.exec(t)
      if (trailing) out.push(`//${trailing[1]}`)
    }
  }
  return out
}

/** Rule 2 over one source file: the comment lines that declare an EE origin. */
export function eeDeclarations(content: string): string[] {
  return commentLines(content).filter((l) => EE_DECLARATION_RES.some((re) => re.test(l)))
}

/** Claims of derivation from Operately (not mere mentions of the name). */
export const OPERATELY_DERIVATION_RE =
  /\b(?:adapted|ported|copied|derived|taken|lifted|borrowed|based)\s+(?:on|from)\s+(?:the\s+)?operately\b|\bgithub\.com\/operately\b|\boperately\/operately\b|\bSource:\s*operately\//i

/** GPL-family licence markers: SPDX identifiers or licence-header text (not LGPL). */
export const GPL_LICENSE_RE =
  /SPDX-License-Identifier:[^\n]*\bA?GPL-\d|GNU\s+(?:Affero\s+)?General\s+Public\s+License/i

/** File extensions treated as source code (all three rules apply only to these). */
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
    if (!isSourceFile(path)) continue
    if (eeDeclarations(content).length > 0) {
      violations.push(`${path}: declares an Enterprise-Edition source (${EE_PATH}); it must never be reused (TECH-SPEC §6.1)`)
      continue
    }
    if (excluded(path, prefixes)) continue
    if (OPERATELY_DERIVATION_RE.test(content) && !PROVENANCE_HEADER_RE.test(content)) {
      violations.push(`${path}: derived from Operately without the per-file provenance header (TECH-SPEC §6.1)`)
    }
    if (GPL_LICENSE_RE.test(content)) {
      violations.push(`${path}: carries a GPL/AGPL licence header or SPDX identifier`)
    }
  }
  return violations
}
