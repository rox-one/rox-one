/**
 * TipTap-free Rox callout kind tables and helpers.
 *
 * Kept separate from `rox-block-syntax.ts` so vault/document-IA code can
 * canonicalize Obsidian callout kinds without evaluating the TipTap stack.
 */

export type RoxBlockKind =
  | 'note'
  | 'info'
  | 'warning'
  | 'tip'
  | 'success'
  | 'question'
  | 'spoiler'
  | 'details'

/** Canonical kinds accepted by Rox (Obsidian-compatible callouts). */
export const ROX_BLOCK_KINDS: readonly RoxBlockKind[] = [
  'note',
  'info',
  'warning',
  'tip',
  'success',
  'question',
  'spoiler',
  'details',
] as const

/**
 * Optional inbound Obsidian aliases → canonical Rox kind.
 * Serialize only the canonical kind.
 */
export const ROX_BLOCK_KIND_ALIASES: Readonly<Record<string, RoxBlockKind>> = {
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
}

const ROX_BLOCK_KIND_SET = new Set<string>(ROX_BLOCK_KINDS)

export function canonicalizeRoxBlockKind(raw: string): RoxBlockKind | null {
  const lower = raw.toLowerCase()
  if (ROX_BLOCK_KIND_SET.has(lower)) return lower as RoxBlockKind
  return ROX_BLOCK_KIND_ALIASES[lower] ?? null
}

/**
 * Slash-menu search aliases for a Rox callout kind: the canonical kind name,
 * every inbound Obsidian alias that canonicalizes to it, plus optional extras
 * (e.g. `callout` / `annotation` on note). Keeps parse and slash in sync.
 */
export function slashAliasesForRoxBlockKind(
  kind: RoxBlockKind,
  extras: readonly string[] = [],
): string[] {
  const inbound = Object.entries(ROX_BLOCK_KIND_ALIASES)
    .filter(([, canonical]) => canonical === kind)
    .map(([alias]) => alias)
  return [...new Set([kind, ...inbound, ...extras])]
}
