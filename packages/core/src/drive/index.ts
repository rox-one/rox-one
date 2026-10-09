/**
 * W1-14 (#1511) — Personal Drive contracts (TECH-SPEC §16, ADR-U17).
 *
 * Storage backend, upload protocol, ledger and quota arithmetic on top of the
 * v1 `file_object` / `folder` model. Package DRV builds the Drive surface on
 * these names; the reference handlers in `@rox/server-core/drive` implement
 * them against the ordinary record backends until SeaweedFS lands.
 */

export {
  DEFAULT_DRIVE_QUOTA_BYTES, DRIVE_STATES, GIB_BYTES, MIB_BYTES, QUOTA_METER_CRITICAL_PERCENT, QUOTA_METER_WARNING_PERCENT,
  QUOTA_NOTIFICATION_THRESHOLDS, QUOTA_WARNING_COOLDOWN_MS, TIB_BYTES, admitUpload, creditReservation, crossedQuotaThresholds, driveStateFor,
  formatDriveSize, quotaSnapshot, quotaWarningAllowed,
} from './quota.ts'
export type { DriveQuota, DriveState, QuotaAdmission, QuotaExceededDetail, QuotaUsage } from './quota.ts'

export {
  STORAGE_LEDGER_REASONS, applyLedgerEntry, chargePrincipal, fileSourceRef, isStorageLedgerReason, ledgerDeltaBytes,
  usedBytesFromLedger,
} from './ledger.ts'
export type { ChargeContext, DriveCounters, FileSource, StorageLedgerEntry, StorageLedgerReason } from './ledger.ts'

export {
  UPLOAD_PARALLEL_PARTS, UPLOAD_PART_MAX_BYTES, UPLOAD_PART_MIN_BYTES, UPLOAD_SESSION_STATUSES, UPLOAD_SESSION_TTL_MS, abortUpload,
  canCompleteUpload, expireUploadSessions, isInstantUpload, openUploadSession, reservedBytesOf, uploadedBytes,
} from './upload.ts'
export type { OpenUploadInput, UploadCompletion, UploadPart, UploadRelease, UploadSession, UploadSessionStatus } from './upload.ts'

export {
  DEFAULT_DRIVE_ROOT_FOLDER_NAME, DRIVE_COMMAND_RISK, DRIVE_CONTRACT_TYPES, MAX_UPLOAD_PARTS, QUOTA_EXCEEDED_CODE, planUploadParts,
  quotaExceededError,
} from './commands.ts'
export type {
  DriveAbortUploadPayload, DriveAbortUploadResult, DriveCompleteUploadPayload, DriveCompleteUploadResult, DriveContractType,
  DriveOpenUploadPayload, DriveOpenUploadResult, DriveProvisionPayload, DriveProvisionResult, QuotaExceededError, UploadPartPlan,
} from './commands.ts'