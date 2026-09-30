import type { Rox2EntityRef } from '../rox2/platform-contract.ts'

/** References only. The canonical owner must authorize and resolve these identities. */
export type TableSurfaceHost =
  | { kind: 'standalone' }
  | { kind: 'note' | 'document' | 'dashboard' | 'application'; ref: Rox2EntityRef; blockId: string }

export type TableSurfaceMode = { kind: 'live' } | { kind: 'snapshot'; snapshotId: string }
export type TableSurfacePresentation = {
  density?: 'compact' | 'comfortable'
  height?: number
  showToolbar?: boolean
}
export type TableSurface = {
  version: 1
  type: 'rox-table'
  baseRef: Rox2EntityRef
  tableId: string
  viewId: string
  host: TableSurfaceHost
  mode: TableSurfaceMode
  presentation?: TableSurfacePresentation
}
export type CreateTableSurfaceInput = Omit<TableSurface, 'version' | 'type' | 'mode'> & {
  mode?: TableSurfaceMode
}
export type TableSurfaceErrorCode = 'invalid-json' | 'invalid-shape' | 'too-large' | 'cross-workspace'
export type TableSurfaceDecodeResult =
  | { status: 'valid'; surface: TableSurface }
  | { status: 'unsupported-version'; version: number; raw: string }
  | { status: 'invalid'; code: TableSurfaceErrorCode }

export const TABLE_CAPABILITIES = [
  'readRows', 'createRows', 'editRows', 'deleteRows', 'editSchema', 'manageViews',
  'runActions', 'manageAutomations', 'viewCharts', 'viewHistory', 'export',
  'manageSync', 'managePermissions', 'configureAI', 'publish',
] as const
export type TableCapability = typeof TABLE_CAPABILITIES[number]
export type TableCapabilityEvidence = {
  sourceReadable: boolean
  hostReadable: boolean
  schemaSupported: boolean
  hostMode: 'interactive' | 'read-only'
  runtime: Partial<Record<TableCapability, boolean>>
  grants: Partial<Record<TableCapability, boolean>>
}
export type TableCapabilityUnavailableReason =
  | 'invalid-surface' | 'source-denied' | 'host-denied' | 'unsupported-schema'
  | 'snapshot-read-only' | 'host-read-only' | 'missing-runtime' | 'not-permitted'
export type TableCapabilityAvailability = { available: true } | {
  available: false
  reason: TableCapabilityUnavailableReason
}
export type TableCapabilities = Record<TableCapability, TableCapabilityAvailability>
