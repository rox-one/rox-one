/**
 * Fail-closed provider gate for the white-label knowledge engine (I03-02).
 *
 * Records origin, commit, license, EE boundary, notices, trademark, TLS,
 * auth, and tenant isolation. Missing evidence fails closed — never spawn a
 * managed kernel from an incomplete record.
 *
 * This module does not ship an OEM binary.
 */

export const PROVIDER_GATE_CHECKS = [
  'repository',
  'commit',
  'license',
  'eeBoundary',
  'notices',
  'trademark',
  'tls',
  'auth',
  'tenant',
  'g2',
] as const

export type ProviderGateCheck = (typeof PROVIDER_GATE_CHECKS)[number]

/** Licenses that may ship a managed kernel in this Apache tree. AGPL fails closed. */
export const PROVIDER_GATE_ALLOWED_LICENSES = ['OEM-C', 'Apache-2.0', 'MIT'] as const

export type ProviderGateLicense = (typeof PROVIDER_GATE_ALLOWED_LICENSES)[number]

const COMMIT_SHA = /^[0-9a-f]{40}$/i
const REPO_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/

export interface ProviderGateEvidence {
  repositoryUrl?: string
  commitSha?: string
  license?: string
  eeBoundaryRecorded?: boolean
  noticesPresent?: boolean
  trademarkSiYuanAbsentFromUi?: boolean
  tlsRequiredForRemote?: boolean
  authRequired?: boolean
  tenantWorkspaceIsolated?: boolean
  g2AcceptedVariant?: 'C' | null
}

export interface ProviderGateResult {
  allowed: boolean
  failed: ProviderGateCheck[]
  reasons: Partial<Record<ProviderGateCheck, string>>
}

function fail(
  failed: ProviderGateCheck[],
  reasons: Partial<Record<ProviderGateCheck, string>>,
  check: ProviderGateCheck,
  reason: string,
): void {
  failed.push(check)
  reasons[check] = reason
}

export function evaluateKnowledgeProviderGate(evidence: ProviderGateEvidence = {}): ProviderGateResult {
  const failed: ProviderGateCheck[] = []
  const reasons: Partial<Record<ProviderGateCheck, string>> = {}

  if (!evidence.repositoryUrl || !REPO_URL.test(evidence.repositoryUrl.trim())) {
    fail(failed, reasons, 'repository', 'provider gate: repositoryUrl must be an https GitHub origin')
  }
  if (!evidence.commitSha || !COMMIT_SHA.test(evidence.commitSha.trim())) {
    fail(failed, reasons, 'commit', 'provider gate: commitSha must be a 40-char git sha')
  }
  if (!evidence.license || !(PROVIDER_GATE_ALLOWED_LICENSES as readonly string[]).includes(evidence.license)) {
    fail(failed, reasons, 'license', 'provider gate: license must be OEM-C, Apache-2.0, or MIT (AGPL fail-closed)')
  }
  if (evidence.eeBoundaryRecorded !== true) {
    fail(failed, reasons, 'eeBoundary', 'provider gate: EE boundary must be recorded')
  }
  if (evidence.noticesPresent !== true) {
    fail(failed, reasons, 'notices', 'provider gate: third-party notices are missing')
  }
  if (evidence.trademarkSiYuanAbsentFromUi !== true) {
    fail(failed, reasons, 'trademark', 'provider gate: product UI must not expose the SiYuan trademark')
  }
  if (evidence.tlsRequiredForRemote !== true) {
    fail(failed, reasons, 'tls', 'provider gate: remote knowledge connections require TLS')
  }
  if (evidence.authRequired !== true) {
    fail(failed, reasons, 'auth', 'provider gate: kernel auth token is required')
  }
  if (evidence.tenantWorkspaceIsolated !== true) {
    fail(failed, reasons, 'tenant', 'provider gate: vaults must be isolated per workspace')
  }
  if (evidence.g2AcceptedVariant !== 'C') {
    fail(failed, reasons, 'g2', 'provider gate: G2 variant C is not ACCEPTED')
  }

  return { allowed: failed.length === 0, failed, reasons }
}

export function assertKnowledgeProviderGate(evidence: ProviderGateEvidence = {}): void {
  const result = evaluateKnowledgeProviderGate(evidence)
  if (result.allowed) return
  const first = result.failed[0]
  throw new Error(reasonsOrDefault(result, first))
}

function reasonsOrDefault(result: ProviderGateResult, check: ProviderGateCheck | undefined): string {
  if (check && result.reasons[check]) return result.reasons[check] as string
  return 'provider gate: blocked'
}
