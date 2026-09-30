import { isAlias, isMap, isScalar, parseDocument, type Scalar, type YAMLMap } from 'yaml'
import {
  applyRawSpanPatches, previewRawSpanPatches, retainedText, retainedSourceHash, retainSource, utf8Bytes, utf8Text,
  type RawSpanPreview, type RawSpanResult, type RawSpanError, type RetainedSource, type SourceRange,
} from './retained-source.ts'

export type PropertyValue = string | number | boolean | null
export type PropertyBinding = {
  keyPath: string[]
  value?: PropertyValue
  range?: SourceRange
  style?: string
  readOnly?: 'unsupportedValue' | 'sharedAnchor' | 'unknownTag'
}
export type FrontmatterProjection =
  | { status: 'ok'; properties: PropertyBinding[]; warnings: string[] }
  | { status: 'readOnly'; code: 'validation' | 'unknownFormat' | 'conflict'; sourceHash: string }
export type PropertyPatchPreview = RawSpanPreview & { propertyKeyPath: string[]; propertyValue: PropertyValue }

function scalarValue(value: unknown): value is PropertyValue {
  return value === null || (typeof value === 'string' && utf8Text(utf8Bytes(value)) === value)
    || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}
function byteOffset(text: string, charOffset: number): number { return utf8Bytes(text.slice(0, charOffset)).length }
const supportedTags = new Set(['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(name => `tag:yaml.org,2002:${name}`))

/** Inspect the CST; never stringify the complete YAML document. */
export function projectFrontmatter(source: RetainedSource): FrontmatterProjection {
  if (retainedSourceHash(source.bytes) !== source.sourceHash) {
    return { status: 'readOnly', code: 'conflict', sourceHash: source.sourceHash }
  }
  // Cached line/CST projections are disposable; only the retained bytes are authority.
  source = retainSource(source.bytes)
  if (source.diagnostics.length) return { status: 'readOnly', code: 'validation', sourceHash: source.sourceHash }
  if (!source.frontmatter) return { status: 'ok', properties: [], warnings: [] }
  const frontmatter = source.frontmatter
  const yamlSource = retainedText(source, { start: frontmatter.contentStart, end: frontmatter.contentEnd })
  // YAML's CST reader expects LF/CRLF. A bare CR becomes one LF only in its
  // disposable view, preserving every UTF-16 offset into the original bytes.
  const doc = parseDocument(yamlSource.replace(/\r(?!\n)/g, '\n'), { keepSourceTokens: true, uniqueKeys: true })
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) {
    return { status: 'readOnly', code: 'validation', sourceHash: source.sourceHash }
  }
  const properties: PropertyBinding[] = []
  let unsupportedKeys = false
  function visit(map: YAMLMap, keyPath: string[], inheritedReadOnly?: PropertyBinding['readOnly']) {
    for (const pair of map.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || (pair.key.tag && !supportedTags.has(pair.key.tag))) {
        unsupportedKeys = true; continue
      }
      const path = [...keyPath, pair.key.value]
      const value = pair.value
      const restricted = inheritedReadOnly ?? (isScalar(value) && value.anchor ? 'sharedAnchor' : undefined)
        ?? ((isScalar(value) || isMap(value)) && value.tag && !supportedTags.has(value.tag) ? 'unknownTag' : undefined)
      if (isMap(value)) { visit(value, path, restricted ?? (value.anchor ? 'sharedAnchor' : undefined)); continue }
      if (!isScalar(value) || isAlias(value) || !value.range || !scalarValue(value.value)) {
        properties.push({ keyPath: path, readOnly: 'unsupportedValue' }); continue
      }
      const range = { start: frontmatter.contentStart + byteOffset(yamlSource, value.range[0]),
        end: frontmatter.contentStart + byteOffset(yamlSource, value.range[1]) }
      const block = value.type === 'BLOCK_LITERAL' || value.type === 'BLOCK_FOLDED'
      properties.push({ keyPath: path, value: value.value, range, style: value.type,
        ...((restricted || block) ? { readOnly: restricted ?? 'unsupportedValue' } : {}) })
    }
  }
  if (isMap(doc.contents)) visit(doc.contents, [])
  if (unsupportedKeys) return { status: 'readOnly', code: 'unknownFormat', sourceHash: source.sourceHash }
  return { status: 'ok', properties, warnings: doc.warnings.map(warning => warning.code) }
}

function scalarText(value: PropertyValue, style?: Scalar['type'] | string): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)
  if (style === 'QUOTE_SINGLE' && !/[\r\n]/.test(value)) return `'${value.replace(/'/g, "''")}'`
  return JSON.stringify(value)
}

/** An existing scalar only. Key creation/renames/complex YAML require a separate conversion preview. */
export function previewPropertyPatch(source: RetainedSource, keyPath: readonly string[], value: PropertyValue,
  expectedSourceHash = source.sourceHash): PropertyPatchPreview | RawSpanError {
  if (!Array.isArray(keyPath) || !keyPath.length || keyPath.some(key => typeof key !== 'string' || !key.length)
    || !scalarValue(value)) return { status: 'error', code: 'validation' }
  if (expectedSourceHash !== source.sourceHash) return { status: 'error', code: 'conflict' }
  const projection = projectFrontmatter(source)
  if (projection.status === 'readOnly') return { status: 'error', code: projection.code }
  const binding = projection.properties.find(property => JSON.stringify(property.keyPath) === JSON.stringify(keyPath))
  if (!binding?.range || binding.readOnly) return { status: 'error', code: 'unknownFormat' }
  const expected = retainedText(source, binding.range)
  const preview = previewRawSpanPatches(source, [{ ...binding.range, expected,
    replacement: Object.is(binding.value, value) ? expected : scalarText(value, binding.style) }],
  { expectedSourceHash, purpose: { kind: 'property', keyPath: [...keyPath], value } })
  if ('status' in preview) return preview
  // Validate the actual changed source and typed field readback before offering a patch.
  const applied = applyRawSpanPatches(source, preview)
  if (applied.status !== 'ok') return applied
  const readback = projectFrontmatter(retainSource(applied.bytes))
  if (readback.status !== 'ok' || !Object.is(readback.properties.find(property => JSON.stringify(property.keyPath) === JSON.stringify(keyPath))?.value, value)) {
    return { status: 'error', code: 'validation' }
  }
  return { ...preview, propertyKeyPath: [...keyPath], propertyValue: value }
}

/** Recompute the supported field patch and typed readback on apply, before Doc CAS. */
export function applyPropertyPatch(current: RetainedSource, preview: PropertyPatchPreview): RawSpanResult {
  if (!preview || preview.purpose?.kind !== 'property' || !Array.isArray(preview.propertyKeyPath)
    || JSON.stringify(preview.propertyKeyPath) !== JSON.stringify(preview.purpose.keyPath)
    || !scalarValue(preview.propertyValue) || !Object.is(preview.propertyValue, preview.purpose.value)) {
    return { status: 'error', code: 'validation' }
  }
  const raw = applyRawSpanPatches(current, preview)
  if (raw.status !== 'ok') return raw
  const reviewed = previewPropertyPatch(current, preview.propertyKeyPath, preview.propertyValue, preview.expectedSourceHash)
  if ('status' in reviewed) return reviewed
  if (reviewed.digest !== preview.digest) return { status: 'error', code: 'validation' }
  return raw
}

/** Explicit field rebase permits other bytes to change; edits of the selected scalar conflict. */
export function rebasePropertyPatch(base: RetainedSource, current: RetainedSource,
  preview: PropertyPatchPreview): PropertyPatchPreview | RawSpanError {
  const checked = applyPropertyPatch(base, preview)
  if (checked.status !== 'ok') return checked
  const before = projectFrontmatter(base)
  const after = projectFrontmatter(current)
  if (before.status !== 'ok') return { status: 'error', code: before.code }
  if (after.status !== 'ok') return { status: 'error', code: after.code }
  const key = JSON.stringify(preview.propertyKeyPath)
  const original = before.properties.find(property => JSON.stringify(property.keyPath) === key)
  const target = after.properties.find(property => JSON.stringify(property.keyPath) === key)
  if (!original?.range || !target?.range || target.readOnly || !Object.is(original.value, target.value)
    || retainedText(base, original.range) !== retainedText(current, target.range)) {
    return { status: 'error', code: 'conflict' }
  }
  return previewPropertyPatch(current, preview.propertyKeyPath, preview.propertyValue, current.sourceHash)
}
