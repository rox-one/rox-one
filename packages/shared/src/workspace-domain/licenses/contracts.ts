import type { Rox2CanonicalResult, Rox2EntityRef } from '../../../../core/src/rox2/platform-contract.ts'
import type { AuthenticatedActor, IdentityDomainEvent, RoxCommand } from '../identity/contracts.ts'

/** References to independently trusted host inputs, never client-supplied approvals or executable paths. */
export interface LicenseDecisionReference {
  readonly resourceId: string
  readonly policyEpoch: string
  readonly reviewRevision: string
  readonly reviewSha256: string
  readonly checkerRevision: string
  readonly checkerSha256: string
  readonly buildSha256: string
}
export interface AuditReleaseLicense {
  readonly artifactDigest: string
  readonly sbomDigest: string
  readonly decisionManifest: LicenseDecisionReference
}
export interface LicenseFinding { readonly code: string; readonly subject: string }
export interface LicenseScope {
  readonly id: string; readonly name: string; readonly version: string
  readonly componentSha256: string; readonly licenseExpression: string | null
}
export interface LicenseEvidence {
  readonly state: 'review_required' | 'reviewed_exact_artifact'
  readonly findings: readonly LicenseFinding[]
  readonly components: readonly LicenseScope[]
}
export interface LicenseComponent {
  readonly entity: Rox2EntityRef
  readonly label: string
  readonly revision: string
  readonly policyEpoch: string
  readonly artifactDigest: string
  readonly sbomDigest: string
  readonly decisionManifest: LicenseDecisionReference
  readonly evidence: LicenseEvidence | null
  readonly auditDigest: string | null
  readonly auditedAt: string | null
  readonly projectionWatermark: string
  readonly canAudit: boolean
  readonly permissionMode: 'owner_bootstrap'
}
export interface LicenseAuditResult extends Rox2CanonicalResult {
  readonly status: 'applied'
  readonly commandId: string; readonly requestHash: string; readonly observedRevision: string
  readonly entity: Rox2EntityRef; readonly receiptId: string; readonly verifiedAt: string
  readonly data: LicenseComponent
}
export interface LicensePage { readonly items: readonly LicenseComponent[]; readonly nextCursor?: string }
export interface LicenseEventPage { readonly events: readonly IdentityDomainEvent[]; readonly nextCursor: string }
export interface LicenseAuthority {
  auditReleaseLicense(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown): Promise<LicenseAuditResult>
  getLicenseComponent(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown): Promise<LicenseComponent>
  listLicenseComponents(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown): Promise<LicensePage>
  licenseEvents(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown): Promise<LicenseEventPage>
}
export interface LicenseRepositoryPort {
  assertRead(actor: AuthenticatedActor, workspaceId: string, resourceIds: readonly string[]): Promise<void>
  audit(actor: AuthenticatedActor, command: RoxCommand<AuditReleaseLicense>): Promise<LicenseAuditResult>
  get(actor: AuthenticatedActor, workspaceId: string, resourceId: string): Promise<LicenseComponent>
  list(actor: AuthenticatedActor, workspaceId: string, limit: number, cursor?: string): Promise<LicensePage>
  events(actor: AuthenticatedActor, workspaceId: string, resourceId: string, limit: number, cursor?: string): Promise<LicenseEventPage>
}
export const DOMAIN_LICENSE_RPC = {
  AUDIT: 'domain.audit.releaseLicense', GET: 'domain.license.get', LIST: 'domain.license.list', EVENTS: 'domain.license.events',
} as const
