import { visibleError } from '../hooks/onboarding-visible-error'

const SAME_PROVIDER_RE = /source and target providers must match|same provider\/backend/i
const SDK_NOT_READY_RE = /SDK context is not initialized|send one message in (the parent|this) session/i
const HISTORY_UNAVAILABLE_RE = /no native anchor|stored (ROX )?history|stored conversation/i

export type BranchErrorCopy = {
  fallback: string
  sameProvider: string
  sdkNotReady: string
  historyUnavailable: string
}

/** Toast description for session branch failures. Empty/OMP leaks use fallback. */
export function branchErrorDescription(
  error: unknown,
  copy: BranchErrorCopy,
): string {
  const raw = error instanceof Error ? error.message : ''
  if (SAME_PROVIDER_RE.test(raw)) return copy.sameProvider
  if (SDK_NOT_READY_RE.test(raw)) return copy.sdkNotReady
  if (HISTORY_UNAVAILABLE_RE.test(raw)) return copy.historyUnavailable
  return visibleError(raw, copy.fallback)
}
