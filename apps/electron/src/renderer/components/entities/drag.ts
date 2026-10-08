/**
 * W1-08 (#1505) — X-13 drag source for entity chips and rows.
 *
 * Chips put `application/x-rox-entity-ref` on the drag: JSON with the
 * formatted ref and its label. Wave 1 registers no drop targets; this MIME
 * type is the contract later drop zones will read.
 */
import { formatEntityRef, parseEntityRef, type EntityRef } from '@rox/core/entities'

export const ENTITY_REF_MIME = 'application/x-rox-entity-ref'

export interface EntityDragPayload {
  /** Canonical `kind:id[#fragment]` text. */
  ref: string
  label: string
}

type DataTransferLike = Pick<DataTransfer, 'setData' | 'getData'> & { effectAllowed?: DataTransfer['effectAllowed'] }

export function entityDragPayload(ref: EntityRef, label: string): EntityDragPayload {
  return { ref: formatEntityRef(ref), label }
}

export function setEntityDragData(dataTransfer: DataTransferLike, ref: EntityRef, label: string): EntityDragPayload {
  const payload = entityDragPayload(ref, label)
  dataTransfer.setData(ENTITY_REF_MIME, JSON.stringify(payload))
  try { dataTransfer.effectAllowed = 'copyLink' } catch { /* read-only in some environments */ }
  return payload
}

/** Parse a drag payload. Returns null for anything malformed or not a valid ref. */
export function readEntityDragData(dataTransfer: Pick<DataTransfer, 'getData'>): (EntityDragPayload & { entityRef: EntityRef }) | null {
  let raw = ''
  try { raw = dataTransfer.getData(ENTITY_REF_MIME) } catch { return null }
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const { ref, label } = parsed as { ref?: unknown; label?: unknown }
  if (typeof ref !== 'string' || typeof label !== 'string') return null
  const result = parseEntityRef(ref)
  if (!result.ok) return null
  return { ref: formatEntityRef(result.value), label, entityRef: result.value }
}
