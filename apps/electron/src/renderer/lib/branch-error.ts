import { visibleError } from '../hooks/onboarding-visible-error'

const SAME_PROVIDER_RE = /source and target providers must match|same provider\/backend/i

/** Toast description for session branch failures. Empty/OMP leaks use fallback. */
export function branchErrorDescription(
  error: unknown,
  copy: { fallback: string; sameProvider: string },
): string {
  const raw = error instanceof Error ? error.message : ''
  if (SAME_PROVIDER_RE.test(raw)) return copy.sameProvider
  return visibleError(raw, copy.fallback)
}
