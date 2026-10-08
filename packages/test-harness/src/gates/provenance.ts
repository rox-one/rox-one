/**
 * W1-10 (#1507) — provenance check core.
 *
 * Shared by `scripts/check-provenance.ts`. Three rules (TECH-SPEC §6.1):
 * 1. files mentioning `operately` (case-insensitive, TS/TSX) must carry the
 *    per-file provenance header;
 * 2. nothing may declare an Enterprise-Edition source path (it is
 *    never reused);
 * 3. new code must contain no GPL/AGPL markers.
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
const OPERATELY_MENTION_RE = /operately/i
const GPL_MARKER_RE = /GNU (General|Affero General) Public License|AGPL/i

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
    if (excluded(path, prefixes)) continue
    if ((path.endsWith('.ts') || path.endsWith('.tsx')) && OPERATELY_MENTION_RE.test(content)) {
      if (!PROVENANCE_HEADER_RE.test(content)) {
        violations.push(`${path}: mentions Operately without the per-file provenance header (TECH-SPEC §6.1)`)
      }
    }
    if (GPL_MARKER_RE.test(content)) {
      violations.push(`${path}: contains a GPL/AGPL marker`)
    }
  }
  return violations
}
