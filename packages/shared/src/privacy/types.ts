/**
 * Product-data consent (Issue 01 / DG-01).
 *
 * Legal copy is still a product sign-off (`DG-01`). This module is the
 * engineering surface: truthful purpose toggles, append-only events,
 * local export, and deletion receipts. Credentials, cookies and passkeys
 * never enter replica or training payloads.
 */

export const CONSENT_SCHEMA_VERSION = 'dg-01-v1' as const

export const CONSENT_PURPOSES = [
  'accountRecoveryReplica',
  'realtimeSync',
  'aiIndexing',
  'cloudInference',
  'productImprovement',
] as const

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const EXCLUDED_TRAINING_CATEGORIES = ['credentials', 'cookies', 'passkeys'] as const
export type ExcludedTrainingCategory = (typeof EXCLUDED_TRAINING_CATEGORIES)[number]

export type ConsentAction = 'grant' | 'revoke' | 'migrate-unset'

export type DeletionStatus = 'none' | 'queued' | 'completed'

export interface ConsentEvent {
  id: string
  at: number
  purpose: ConsentPurpose | '*'
  action: ConsentAction
  schemaVersion: typeof CONSENT_SCHEMA_VERSION
  deletionStatus?: DeletionStatus
}

export interface ConsentPurposes {
  accountRecoveryReplica: boolean
  realtimeSync: boolean
  aiIndexing: boolean
  cloudInference: boolean
  productImprovement: boolean
}

export interface ExportReceipt {
  id: string
  requestedAt: number
  completedAt: number
  path: string
  excluded: readonly ExcludedTrainingCategory[]
}

export interface DeletionReceipt {
  id: string
  status: 'queued' | 'completed'
  requestedAt: number
  completedAt?: number
  localDataKept: true
  remoteSla: 'queued-immediately'
  purposes: ConsentPurpose[]
}

export interface PrivacyState {
  version: 1
  schemaVersion: typeof CONSENT_SCHEMA_VERSION
  purposes: ConsentPurposes
  events: ConsentEvent[]
  exports: ExportReceipt[]
  deletions: DeletionReceipt[]
  migratedAt: number
  updatedAt: number
}

export interface PrivacyDto {
  schemaVersion: typeof CONSENT_SCHEMA_VERSION
  purposes: ConsentPurposes
  events: ConsentEvent[]
  exports: ExportReceipt[]
  deletions: DeletionReceipt[]
  latestDeletion: DeletionReceipt | null
  migratedAt: number
  updatedAt: number
}

export function emptyPurposes(): ConsentPurposes {
  return {
    accountRecoveryReplica: false,
    realtimeSync: false,
    aiIndexing: false,
    cloudInference: false,
    productImprovement: false,
  }
}

export function isConsentPurpose(value: string): value is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value)
}

export function isExcludedTrainingCategory(value: string): value is ExcludedTrainingCategory {
  return (EXCLUDED_TRAINING_CATEGORIES as readonly string[]).includes(value)
}
