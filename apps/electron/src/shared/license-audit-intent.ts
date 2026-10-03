import type { RoxCommand } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { AuditReleaseLicense, LicenseAuditResult, LicenseEventPage } from '../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'

/** View of the existing main-owned encrypted intent slot; no token or new identity authority. */
export type LicenseAuditIntentView =
  | { readonly state: 'none'; readonly eligible: boolean }
  | { readonly state: 'blocked'; readonly eligible: false; readonly code: string; readonly pendingOperation?: 'project.createShared' }
  | { readonly state: 'queued' | 'uncertain'; readonly eligible: true; readonly command: RoxCommand<AuditReleaseLicense> }
export type LicenseAuditAttempt = LicenseAuditIntentView | { readonly state: 'applied'; readonly result: LicenseAuditResult;
  readonly event: LicenseEventPage['events'][number] }
