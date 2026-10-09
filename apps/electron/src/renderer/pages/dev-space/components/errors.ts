import { toErrorMessage } from '@/lib/errors'

/** Transport errors → localized categories without leaking host paths or URLs. */
export function devSpaceErrorKey(error: unknown): string {
  const message = toErrorMessage(error)
  if (/AUTH_FAILED|accessDenied|scope-denied|auth-missing|token-missing/.test(message)) return 'devSpace.error.accessDenied'
  if (/invalid-url|invalid-git-url|unsupported-provider|unsupported-source/.test(message)) return 'devSpace.error.invalidUrl'
  if (/invalid-path|path-escape|root-denied|symlink|outside-root/.test(message)) return 'devSpace.error.invalidPath'
  if (/clone-failed|git-unavailable|not-a-git-repository|invalid-git-identity/.test(message)) return 'devSpace.error.cloneFailed'
  if (/request-cancelled|cancelled/.test(message)) return 'devSpace.error.cancelled'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|offline/.test(message)) return 'devSpace.error.network'
  if (/workspace-missing|project-missing|ENOENT|catalog-unavailable/.test(message)) return 'devSpace.error.unavailable'
  return 'devSpace.error.failed'
}