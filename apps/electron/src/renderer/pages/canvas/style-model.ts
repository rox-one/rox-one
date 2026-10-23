/**
 * Style inspector model for «Доска»: flatten nested style Y.Map fields into
 * editable inspector values, compute common/mixed across a selection, and
 * build board.update patches that merge stroke/font without clobbering siblings.
 *
 * Clean-room — no HyCanvas code or assets.
 */
import type { CanvasDoc, CanvasObject, Fill, Origin, Style } from '@rox/canvas-core'

/** Flat fields the inspector edits. */
export type StyleField =
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'opacity'
  | 'cornerRadius'
  | 'fontSize'
  | 'fontWeight'

export type FieldValue = string | number

/** Per-field state for a multi-selection. */
export type CommonField<T extends FieldValue = FieldValue> =
  | { state: 'empty' } // no object exposes this field
  | { state: 'mixed' }
  | { state: 'value'; value: T }

export type CommonStyle = Record<StyleField, CommonField>

const ALL_FIELDS: readonly StyleField[] = [
  'fill', 'stroke', 'strokeWidth', 'opacity', 'cornerRadius', 'fontSize', 'fontWeight',
]

/** Which fields make sense for a given object type (and shape kind). */
export function applicableFields(o: CanvasObject): ReadonlySet<StyleField> {
  const set = new Set<StyleField>(['opacity'])
  switch (o.type) {
    case 'shape': {
      set.add('fill'); set.add('stroke'); set.add('strokeWidth')
      if (o.props.kind === 'rect' || o.props.kind === undefined) set.add('cornerRadius')
      break
    }
    case 'sticky':
    case 'text':
      set.add('fill'); set.add('stroke'); set.add('strokeWidth')
      set.add('fontSize'); set.add('fontWeight')
      break
    case 'line':
    case 'ink':
    case 'path':
    case 'connector':
      set.add('stroke'); set.add('strokeWidth')
      break
    default:
      // entity / unknown: opacity only
      break
  }
  return set
}

function solidFillColor(fill: Fill | Style['fill'] | undefined): string | undefined {
  if (!fill || typeof fill !== 'object') return undefined
  if ((fill as Fill).type === 'solid' && typeof (fill as { color?: unknown }).color === 'string') {
    return (fill as { color: string }).color
  }
  return undefined
}

/** Read one flat field from an object (undefined = unset / not applicable). */
export function readField(o: CanvasObject, field: StyleField): FieldValue | undefined {
  if (!applicableFields(o).has(field)) return undefined
  switch (field) {
    case 'fill':
      return solidFillColor(o.style?.fill)
    case 'stroke': {
      const c = o.style?.stroke?.color
      return typeof c === 'string' && c.length > 0 ? c : undefined
    }
    case 'strokeWidth': {
      const w = o.style?.stroke?.width
      return typeof w === 'number' && Number.isFinite(w) ? w : undefined
    }
    case 'opacity':
      return typeof o.opacity === 'number' && Number.isFinite(o.opacity) ? o.opacity : 1
    case 'cornerRadius': {
      const r = o.props.radius
      return typeof r === 'number' && Number.isFinite(r) ? r : undefined
    }
    case 'fontSize': {
      const s = o.style?.font?.size
      return typeof s === 'number' && Number.isFinite(s) ? s : undefined
    }
    case 'fontWeight': {
      const w = o.style?.font?.weight
      return typeof w === 'number' && Number.isFinite(w) ? w : undefined
    }
  }
}

function same(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b)
  return a === b
}

/** Compute common/mixed/empty for every inspector field across the selection. */
export function commonStyle(objects: readonly CanvasObject[]): CommonStyle {
  const out = {} as CommonStyle
  for (const field of ALL_FIELDS) {
    let seen = false
    let first: FieldValue | undefined
    let mixed = false
    let anyApplicable = false
    for (const o of objects) {
      if (!applicableFields(o).has(field)) continue
      anyApplicable = true
      const v = readField(o, field)
      if (!seen) { first = v; seen = true }
      else if (!same(first, v)) { mixed = true; break }
    }
    if (!anyApplicable) out[field] = { state: 'empty' }
    else if (mixed) out[field] = { state: 'mixed' }
    else if (first === undefined) out[field] = { state: 'empty' }
    else out[field] = { state: 'value', value: first }
  }
  return out
}

/** Fields that at least one selected object can edit. */
export function visibleFields(objects: readonly CanvasObject[]): StyleField[] {
  const u = new Set<StyleField>()
  for (const o of objects) for (const f of applicableFields(o)) u.add(f)
  return ALL_FIELDS.filter(f => u.has(f))
}

/**
 * Build a board.update patch for one object + one field.
 * Merges into existing stroke/font so sibling keys survive.
 * Returns null when the field does not apply to this object.
 */
export function patchForField(
  o: CanvasObject,
  field: StyleField,
  value: FieldValue,
): Partial<Omit<CanvasObject, 'id'>> | null {
  if (!applicableFields(o).has(field)) return null
  switch (field) {
    case 'fill': {
      if (typeof value !== 'string' || !value) return null
      const fill: Fill = { type: 'solid', color: value }
      // Only the named style key is written (board.update merges key-wise).
      return { style: { fill } }
    }
    case 'stroke': {
      if (typeof value !== 'string' || !value) return null
      const prev = o.style?.stroke
      const stroke = {
        color: value,
        width: typeof prev?.width === 'number' ? prev.width : 1.5,
        ...(prev?.dash ? { dash: prev.dash } : {}),
      }
      return { style: { stroke } }
    }
    case 'strokeWidth': {
      const width = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(width) || width < 0) return null
      const prev = o.style?.stroke
      const stroke = {
        color: typeof prev?.color === 'string' && prev.color ? prev.color : 'currentColor',
        width,
        ...(prev?.dash ? { dash: prev.dash } : {}),
      }
      return { style: { stroke } }
    }
    case 'opacity': {
      const opacity = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(opacity)) return null
      return { opacity: Math.min(1, Math.max(0, opacity)) }
    }
    case 'cornerRadius': {
      const radius = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(radius) || radius < 0) return null
      // Only `radius` — do not re-write sibling props (e.g. kind).
      return { props: { radius } }
    }
    case 'fontSize': {
      const size = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(size) || size <= 0) return null
      const prev = o.style?.font
      const font = {
        family: typeof prev?.family === 'string' && prev.family ? prev.family : 'sans-serif',
        size,
        ...(typeof prev?.weight === 'number' ? { weight: prev.weight } : {}),
      }
      return { style: { font } }
    }
    case 'fontWeight': {
      const weight = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(weight) || weight < 100 || weight > 900) return null
      const prev = o.style?.font
      const font = {
        family: typeof prev?.family === 'string' && prev.family ? prev.family : 'sans-serif',
        size: typeof prev?.size === 'number' && prev.size > 0 ? prev.size : 14,
        weight: Math.round(weight / 100) * 100,
      }
      return { style: { font } }
    }
  }
}

/**
 * Apply one inspector field to every selected id that supports it.
 * Skips inapplicable objects (mixed selection of shapes + lines stays consistent).
 * Returns the number of objects actually patched.
 */
export function applyStyleField(
  board: CanvasDoc,
  ids: readonly string[],
  field: StyleField,
  value: FieldValue,
  origin: Origin,
): number {
  let n = 0
  for (const id of ids) {
    const o = board.get(id)
    if (!o || o.locked) continue
    const patch = patchForField(o, field, value)
    if (!patch) continue
    board.update(id, patch, origin)
    n++
  }
  return n
}

/** Hex (#rgb / #rrggbb) or leave as-is for named/currentColor. Used by the color input. */
export function normalizeColorInput(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s
  if (/^[a-zA-Z]+$/.test(s)) return s // named CSS / currentColor
  return null
}

export { ALL_FIELDS }
