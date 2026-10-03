import { isAlias, isMap, isScalar, isSeq, parseDocument, stringify, type Node } from 'yaml'
import { applyPropertyPatch, previewPropertyPatch, projectFrontmatter, type PropertyValue } from './frontmatter-patches.ts'
import { retainSource, retainedSourceHash, retainedText, utf8Bytes, utf8Text } from './retained-source.ts'

export interface PropertyDictionaryPreview {
  expectedRevision: string
  content: string
  digest: string
  requiresReview: boolean
  before: string
  after: string
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return utf8Text(utf8Bytes(value)) === value
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 10_000 && value.every(item => isJsonValue(item, depth + 1))
  if (typeof value === 'object' && value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.entries(value).every(([key, item]) => key.length <= 512 && utf8Text(utf8Bytes(key)) === key && isJsonValue(item, depth + 1))
  }
  return false
}

const normalizableTags = new Set(['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(name => `tag:yaml.org,2002:${name}`))
/** A reviewed conversion can normalize standard JSON-shaped YAML. Unknown tag
 * semantics and shared/aliased values require a separate repair/conversion. */
function normalizableNode(node: Node | null, depth = 0): boolean {
  if (depth > 32) return false
  if (node === null) return true
  if (isAlias(node) || node.anchor || (node.tag && !normalizableTags.has(node.tag))) return false
  if (isScalar(node)) return isJsonValue(node.value)
  if (isSeq(node)) return node.items.length <= 10_000 && node.items.every(item => normalizableNode(item as Node | null, depth + 1))
  if (isMap(node)) return node.items.every(pair => isScalar(pair.key) && typeof pair.key.value === 'string'
    && normalizableNode(pair.key, depth + 1) && normalizableNode(pair.value as Node | null, depth + 1))
  return false
}
function sameDictionaryValue(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true
  // The native legacy reader exposes timestamps as Date, while RPC transports
  // them as ISO strings. Unchanged dictionary fields are not edit commands.
  if ((previous !== null && typeof previous === 'object') || (next !== null && typeof next === 'object')) {
    try { return JSON.stringify(previous) === JSON.stringify(next) } catch { return false }
  }
  return false
}

/** Existing scalar edits use retained spans. Other edits expose the exact YAML
 * conversion for review; prose and every byte after the header remain intact. */
export function previewPropertyDictionary(content: string, previous: Record<string, unknown>, next: Record<string, unknown>): PropertyDictionaryPreview {
  if (utf8Text(utf8Bytes(content)) !== content) throw new Error('Unsupported source document')
  const source = retainSource(content)
  if (source.diagnostics.length) throw new Error('Unsupported source document')
  const projection = projectFrontmatter(source)
  if (projection.status !== 'ok') throw new Error('Unsupported source document')
  const yaml = source.frontmatter ? retainedText(source, { start: source.frontmatter.contentStart, end: source.frontmatter.contentEnd }) : ''
  const document = parseDocument(yaml.replace(/\r(?!\n)/g, '\n'), { uniqueKeys: true })
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) throw new Error('Unsupported source document')
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Invalid previous properties')
  if (!next || typeof next !== 'object' || Array.isArray(next) || !isJsonValue(next)) throw new Error('Invalid properties')
  const json = JSON.stringify(next)
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > 1024 * 1024) throw new Error('Invalid properties')
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
  const sourceKeys = new Set(isMap(document.contents) ? document.contents.items.map(pair => (pair.key as { value: string }).value) : [])
  const bindings = new Map(projection.properties.filter(binding => binding.keyPath.length === 1).map(binding => [binding.keyPath[0]!, binding]))
  const changed = keys.filter(key => {
    if (!Object.hasOwn(next, key)) return Object.hasOwn(previous, key) && sourceKeys.has(key)
    if (Object.hasOwn(previous, key) && sameDictionaryValue(previous[key], next[key])) return false
    const binding = bindings.get(key)
    // The legacy reader may return {} for a valid header with an unknown tag.
    // Its supplied dictionary cannot decide an existing scalar's current value.
    if (binding && Object.hasOwn(binding, 'value')) return !Object.is(binding.value, next[key])
    return !sourceKeys.has(key) || JSON.stringify(previous[key]) !== JSON.stringify(next[key])
  })
  let candidate = source
  let requiresReview = false
  for (const key of changed) {
    const value = next[key]
    const binding = bindings.get(key)
    if (!binding?.range || binding.readOnly || !Object.hasOwn(next, key)
      || !(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) {
      requiresReview = true; break
    }
    const preview = previewPropertyPatch(candidate, [key], value as PropertyValue)
    if ('status' in preview) { requiresReview = true; break }
    const applied = applyPropertyPatch(candidate, preview)
    if (applied.status !== 'ok') throw new Error('Invalid property patch')
    candidate = retainSource(applied.bytes)
  }
  const originalHeader = source.frontmatter ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(source.bytes.slice(0, source.frontmatter.end)) : ''
  const originalBody = source.frontmatter ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(source.bytes.slice(source.frontmatter.end)) : content.replace(/^\uFEFF/, '')
  let after = originalHeader
  let result = candidate.text
  if (requiresReview) {
    if (document.warnings.length || !normalizableNode(document.contents)) throw new Error('Unsupported source property conversion')
    const eol = source.lines.find(line => line.eol)?.eol ?? '\n'
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
    after = `${bom}---${eol}${stringify(next).replace(/\r\n|\r|\n/g, eol)}---${eol}`
    result = after + originalBody
  } else if (candidate.frontmatter) {
    after = new TextDecoder('utf-8', { ignoreBOM: true }).decode(candidate.bytes.slice(0, candidate.frontmatter.end))
  }
  const expectedRevision = source.sourceHash
  return { expectedRevision, content: result, requiresReview, before: originalHeader, after,
    digest: retainedSourceHash(JSON.stringify({ expectedRevision, content: result })) }
}
