import type { Rox2EntityRef } from '../rox2/platform-contract.ts'
import type {
  TableSurface, TableSurfaceDecodeResult, TableSurfaceErrorCode,
  TableSurfaceHost, TableSurfaceMode, TableSurfacePresentation,
} from './surface-types.ts'

export const TABLE_SURFACE_MAX_BYTES = 16 * 1024
const MAX_ID_LENGTH = 1024
const encoder = new TextEncoder()

export class TableSurfaceValidationError extends Error {
  readonly code: TableSurfaceErrorCode
  constructor(code: TableSurfaceErrorCode) {
    super(`Invalid table surface: ${code}`)
    this.name = 'TableSurfaceValidationError'
    this.code = code
  }
}
function fail(code: TableSurfaceErrorCode = 'invalid-shape'): never {
  throw new TableSurfaceValidationError(code)
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail()
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return fail()
  // Read inert own data only. Include hidden keys so validation cannot silently
  // drop them; a detached null-prototype record also avoids inherited getters.
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return fail()
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true })
  }
  return result
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) fail()
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) return fail()
  return value
}
function ref(value: unknown): Rox2EntityRef {
  const v = object(value)
  keys(v, ['workspaceId', 'entityId', 'revisionId', 'accountNamespace'])
  const result: Rox2EntityRef = { workspaceId: id(v.workspaceId), entityId: id(v.entityId) }
  if (Object.hasOwn(v, 'revisionId')) result.revisionId = id(v.revisionId)
  if (Object.hasOwn(v, 'accountNamespace')) result.accountNamespace = id(v.accountNamespace)
  return result
}
function host(value: unknown, workspaceId: string): TableSurfaceHost {
  const v = object(value)
  if (v.kind === 'standalone') { keys(v, ['kind']); return { kind: 'standalone' } }
  if (v.kind !== 'note' && v.kind !== 'document' && v.kind !== 'dashboard' && v.kind !== 'application') return fail()
  keys(v, ['kind', 'ref', 'blockId'])
  const target = ref(v.ref)
  if (target.workspaceId !== workspaceId) return fail('cross-workspace')
  return { kind: v.kind, ref: target, blockId: id(v.blockId) }
}
function mode(value: unknown): TableSurfaceMode {
  const v = object(value)
  if (v.kind === 'live') { keys(v, ['kind']); return { kind: 'live' } }
  if (v.kind === 'snapshot') {
    keys(v, ['kind', 'snapshotId'])
    return { kind: 'snapshot', snapshotId: id(v.snapshotId) }
  }
  return fail()
}
function presentation(value: unknown): TableSurfacePresentation {
  const v = object(value); keys(v, ['density', 'height', 'showToolbar'])
  const result: TableSurfacePresentation = {}
  if (Object.hasOwn(v, 'density')) {
    if (v.density !== 'compact' && v.density !== 'comfortable') return fail()
    result.density = v.density
  }
  if (Object.hasOwn(v, 'height')) {
    if (typeof v.height !== 'number' || !Number.isInteger(v.height) || v.height < 120 || v.height > 2400) return fail()
    result.height = v.height
  }
  if (Object.hasOwn(v, 'showToolbar')) {
    if (typeof v.showToolbar !== 'boolean') return fail()
    result.showToolbar = v.showToolbar
  }
  return result
}
function current(value: unknown): TableSurface {
  const v = object(value)
  keys(v, ['version', 'type', 'baseRef', 'tableId', 'viewId', 'host', 'mode', 'presentation'])
  if (v.version !== 1 || v.type !== 'rox-table') return fail()
  const baseRef = ref(v.baseRef)
  const result: TableSurface = {
    version: 1, type: 'rox-table', baseRef, tableId: id(v.tableId), viewId: id(v.viewId),
    host: host(v.host, baseRef.workspaceId), mode: mode(v.mode),
  }
  if (Object.hasOwn(v, 'presentation')) result.presentation = presentation(v.presentation)
  return result
}
function boundedJson(value: TableSurface): string {
  const raw = JSON.stringify(value)
  if (encoder.encode(raw).byteLength > TABLE_SURFACE_MAX_BYTES) return fail('too-large')
  return raw
}

/** Strict v1 codec. It never reads rows, resolves credentials, or grants access. */
export function encodeTableSurface(value: unknown): string {
  return boundedJson(current(value))
}
export function decodeTableSurface(raw: string): TableSurfaceDecodeResult {
  if (typeof raw !== 'string') return { status: 'invalid', code: 'invalid-shape' }
  // The character bound avoids allocating a large UTF-8 buffer for obviously oversized input.
  if (raw.length > TABLE_SURFACE_MAX_BYTES || encoder.encode(raw).byteLength > TABLE_SURFACE_MAX_BYTES)
    return { status: 'invalid', code: 'too-large' }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { status: 'invalid', code: 'invalid-json' } }
  try {
    const v = object(value)
    if (v.type !== 'rox-table' || typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version < 1) return fail()
    // Preserve future data without interpreting, activating or converting it to v1.
    if (v.version > 1) return { status: 'unsupported-version', version: v.version, raw }
    return { status: 'valid', surface: current(v) }
  } catch (error) {
    return { status: 'invalid', code: error instanceof TableSurfaceValidationError ? error.code : 'invalid-shape' }
  }
}
export function createTableSurface(input: unknown): TableSurface {
  const v = object(input)
  keys(v, ['baseRef', 'tableId', 'viewId', 'host', 'mode', 'presentation'])
  const result = current({ ...v, version: 1, type: 'rox-table', mode: v.mode === undefined ? { kind: 'live' } : v.mode })
  boundedJson(result)
  return result
}
export function retargetTableSurface(surface: unknown, newHost: unknown): TableSurface {
  const existing = current(surface)
  const result = current({ ...existing, host: newHost })
  boundedJson(result)
  return result
}
/** Canonical dataset identity, intentionally independent of view, host and revision. */
export function tableSourceKey(surface: unknown): string {
  const v = current(surface)
  return JSON.stringify([v.baseRef.workspaceId, v.baseRef.accountNamespace ?? null, v.baseRef.entityId, v.tableId])
}
/** Query identity only: an authorized cache must ALSO include actor, policy epoch and source revision. */
export function tableQueryKey(surface: unknown): string {
  const v = current(surface)
  return JSON.stringify([tableSourceKey(v), v.viewId, v.baseRef.revisionId ?? null,
    v.mode.kind, v.mode.kind === 'snapshot' ? v.mode.snapshotId : null])
}
