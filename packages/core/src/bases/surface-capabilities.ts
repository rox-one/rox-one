import { TABLE_CAPABILITIES } from './surface-types.ts'
import type { TableCapability, TableCapabilities, TableCapabilityUnavailableReason } from './surface-types.ts'
import { decodeTableSurface, encodeTableSurface } from './table-surface.ts'

const READ_CAPABILITIES = new Set<TableCapability>(['readRows', 'viewCharts', 'viewHistory', 'export'])
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : {}
}
function verifiedTrue(value: unknown, key: string): boolean {
  const v = record(value)
  return Object.hasOwn(v, key) && v[key] === true
}

/**
 * Availability metadata, NOT authorization. Evidence must come from the current
 * server/source context. Every real read/command still requires owner-side ACL.
 * It must never be used to authorize Form submissions or another principal.
 */
export function getTableCapabilityAvailability(surface: unknown, evidence: unknown): TableCapabilities {
  const p = record(evidence)
  let snapshot = false
  let common: TableCapabilityUnavailableReason | undefined
  try {
    const parsed = decodeTableSurface(encodeTableSurface(surface))
    if (parsed.status !== 'valid') common = 'invalid-surface'
    else snapshot = parsed.surface.mode.kind === 'snapshot'
  } catch { common = 'invalid-surface' }
  if (!common && !verifiedTrue(p, 'sourceReadable')) common = 'source-denied'
  if (!common && !verifiedTrue(p, 'hostReadable')) common = 'host-denied'
  if (!common && !verifiedTrue(p, 'schemaSupported')) common = 'unsupported-schema'
  const result = {} as TableCapabilities
  for (const capability of TABLE_CAPABILITIES) {
    let reason = common
    if (!reason && !READ_CAPABILITIES.has(capability) && snapshot) reason = 'snapshot-read-only'
    if (!reason && !READ_CAPABILITIES.has(capability) && p.hostMode !== 'interactive') reason = 'host-read-only'
    if (!reason && !verifiedTrue(p.runtime, capability)) reason = 'missing-runtime'
    if (!reason && !verifiedTrue(p.grants, capability)) reason = 'not-permitted'
    result[capability] = reason ? { available: false, reason } : { available: true }
  }
  return result
}
