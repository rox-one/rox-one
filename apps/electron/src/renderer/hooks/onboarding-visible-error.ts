const OMP_LEAK_RE = /\bOMP\b|oh-my-pi|Craft Agents/i

/** User-facing errors: empty and OMP/Craft leaks become the Rox fallback. */
export function visibleError(raw: string | undefined | null, fallback: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed || OMP_LEAK_RE.test(trimmed)) return fallback
  return trimmed
}
