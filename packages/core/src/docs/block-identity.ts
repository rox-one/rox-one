import {
  applyRawSpanPatches, previewRawSpanPatches, retainedSourceHash, retainSource, utf8Bytes,
  type RawSpanPreview, type RawSpanResult, type RawSpanError, type RetainedLine, type RetainedSource, type SourceRange,
} from './retained-source.ts'

export type BlockAnchor = { kind: 'rox' | 'obsidian'; id: string; range: SourceRange }
export type BlockIdentityDiagnostic = {
  code: 'duplicateId' | 'malformedMarker' | 'multipleMarkers' | 'orphanMarker' | 'unsupportedSource'
  range: SourceRange
  id?: string
  otherRange?: SourceRange
}
export type RetainedBlock = {
  kind: 'heading' | 'listItem' | 'paragraph' | 'code' | 'table' | 'opaque'
  range: SourceRange
  text: string
  indent: number
  headingLevel?: number
  list?: { marker: string; ordered: boolean; ordinal?: number; checkbox?: boolean; contentIndent: number; text: string; textRange: SourceRange }
  anchors: BlockAnchor[]
  nodeId?: string
  identity: 'anchored' | 'unanchored' | 'ambiguous'
}
/** Aliases point to one node; this projection contains no independent writable text. */
export type MarkerMapping = {
  markerMappingVersion: 1
  blockId: string
  nodeId: string
  kind: BlockAnchor['kind']
  markerRange: SourceRange
  blockRange: SourceRange
}
export type BlockIdentityProjection = {
  status: 'ok' | 'readOnly'
  code?: 'validation' | 'conflict' | 'unknownFormat'
  version: 1
  markerMappingVersion: 1
  authorityEpoch: number
  sourceHash: string
  blocks: RetainedBlock[]
  mappings: MarkerMapping[]
  diagnostics: BlockIdentityDiagnostic[]
}
export type MarkerMappingPreview = RawSpanPreview & {
  markerMappingVersion: 1
  authorityEpoch: number
  addedMarkers: Array<{ id: string; blockRange: SourceRange }>
}
export type MarkerMappingPolicy = {
  authorityEpoch: number
  markerMappingVersion?: number
  expectedSourceHash?: string
  scope?: 'listTree' | 'allBlocks'
  /** Inject only when preparing a preview; reads never allocate IDs. */
  generateId?: () => string
}

const idPattern = /^[A-Za-z0-9_-]+$/
const roxPattern = /<!--\s*block:([A-Za-z0-9_-]+)\s*-->/g
const listPattern = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/
const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.*)$/
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/

function byteOffset(text: string, charOffset: number): number { return utf8Bytes(text.slice(0, charOffset)).length }
function lineText(line: RetainedLine): string { return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text }
function lineStart(line: RetainedLine): number { return line.start + (line.start === 0 && line.text.startsWith('\uFEFF') ? 3 : 0) }
function indentation(text: string, initialColumns = 0): number {
  let columns = initialColumns
  for (const character of text) {
    if (character === ' ') columns += 1
    else if (character === '\t') columns += 4 - columns % 4
    else break
  }
  return columns
}
function escapedAt(text: string, offset: number): boolean {
  let slashes = 0
  while (offset > 0 && text[offset - 1] === '\\') { slashes += 1; offset -= 1 }
  return slashes % 2 === 1
}
function inlineCodeRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const ticks = /`+/g
  let opening: RegExpExecArray | null
  while ((opening = ticks.exec(text))) {
    if (escapedAt(text, opening.index)) continue
    const count = opening[0].length
    const closing = new RegExp(`(?<!\x60)\x60{${count}}(?!\x60)`, 'g')
    closing.lastIndex = ticks.lastIndex
    let match = closing.exec(text)
    while (match && escapedAt(text, match.index)) match = closing.exec(text)
    if (match) {
      ranges.push({ start: opening.index, end: match.index + count })
      ticks.lastIndex = match.index + count
    }
  }
  return ranges
}
function inlineAnchors(text: string, start: number): { anchors: BlockAnchor[]; diagnostics: BlockIdentityDiagnostic[] } {
  const anchors: BlockAnchor[] = [], diagnostics: BlockIdentityDiagnostic[] = []
  const roxCharacters: Array<{ start: number; end: number }> = []
  const code = inlineCodeRanges(text)
  const inCode = (offset: number) => code.some(range => offset >= range.start && offset < range.end)
  for (const match of text.matchAll(roxPattern)) {
    if (inCode(match.index) || escapedAt(text, match.index)) continue
    roxCharacters.push({ start: match.index, end: match.index + match[0].length })
    anchors.push({ kind: 'rox', id: match[1]!, range: { start: start + byteOffset(text, match.index),
      end: start + byteOffset(text, match.index + match[0].length) } })
  }
  for (const match of text.matchAll(/<!--\s*block:[^\r\n]*?(?:-->|$)/g)) {
    if (inCode(match.index) || escapedAt(text, match.index)) continue
    const offset = start + byteOffset(text, match.index)
    if (!anchors.some(anchor => anchor.range.start === offset)) diagnostics.push({ code: 'malformedMarker',
      range: { start: offset, end: start + byteOffset(text, match.index + match[0].length) } })
  }
  // A trailing ROX comment does not hide a previously imported ^id. Mask
  // ASCII marker characters in the parser view while keeping their offsets.
  let semanticText = text
  for (const marker of roxCharacters) semanticText = semanticText.slice(0, marker.start)
    + ' '.repeat(marker.end - marker.start) + semanticText.slice(marker.end)
  const obsidian = /(?:^|[ \t])\^([A-Za-z0-9_-]+)[ \t]*$/.exec(semanticText)
  if (obsidian) {
    const offset = obsidian.index + obsidian[0].indexOf('^')
    if (!inCode(offset)) anchors.push({ kind: 'obsidian', id: obsidian[1]!, range: {
      start: start + byteOffset(text, offset), end: start + byteOffset(text, offset + obsidian[1]!.length + 1),
    } })
  } else {
    const malformed = /(?:^|[ \t])\^([^ \t]+)[ \t]*$/.exec(semanticText)
    if (malformed && !inCode(malformed.index)) diagnostics.push({ code: 'malformedMarker', range: {
      start: start + byteOffset(text, malformed.index), end: start + utf8Bytes(text).length,
    } })
  }
  return { anchors, diagnostics }
}
function cleanInline(text: string): string {
  const parsed = inlineAnchors(text, 0)
  const bytes = utf8Bytes(text)
  let end = bytes.length
  const parts: Uint8Array[] = []
  for (const anchor of parsed.anchors.sort((a, b) => b.range.start - a.range.start)) {
    parts.unshift(bytes.slice(anchor.range.end, end))
    end = anchor.range.start
  }
  parts.unshift(bytes.slice(0, end))
  return parts.map(part => new TextDecoder('utf-8', { ignoreBOM: true }).decode(part)).join('').trim()
}
function tableDelimiter(text: string): boolean {
  return /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/.test(text)
}
function standaloneMarker(text: string): boolean { return /^[ \t]*<!--\s*block:[^\r\n]*?(?:-->)[ \t]*$/.test(text) }
function standaloneObsidian(text: string): boolean { return /^[ \t]*\^[^ \t]+[ \t]*$/.test(text) }

/** Conservative Markdown projection. Unsupported blocks remain exact opaque ranges. */
function scanBlocks(source: RetainedSource): { blocks: RetainedBlock[]; diagnostics: BlockIdentityDiagnostic[] } {
  const blocks: RetainedBlock[] = [], diagnostics: BlockIdentityDiagnostic[] = []
  const lines = source.lines.filter(line => line.start >= (source.frontmatter?.end ?? 0))
  let pending: BlockAnchor[] = []
  let activeList = false
  const flushPending = () => {
    for (const anchor of pending) diagnostics.push({ code: 'orphanMarker', id: anchor.id, range: anchor.range })
    pending = []
  }
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!, text = lineText(line)
    if (!text.trim()) { index += 1; continue }
    if (standaloneMarker(text)) {
      const parsed = inlineAnchors(text, lineStart(line))
      pending.push(...parsed.anchors)
      diagnostics.push(...parsed.diagnostics)
      index += 1
      continue
    }
    if (standaloneObsidian(text)) {
      const parsed = inlineAnchors(text, lineStart(line)), previous = blocks.at(-1)
      diagnostics.push(...parsed.diagnostics)
      if (previous) previous.anchors.push(...parsed.anchors)
      else for (const anchor of parsed.anchors) diagnostics.push({ code: 'orphanMarker', id: anchor.id, range: anchor.range })
      index += 1
      continue
    }
    let kind: RetainedBlock['kind'] = 'paragraph', endIndex = index + 1
    const indent = indentation(text), list = listPattern.exec(text), heading = headingPattern.exec(text), fence = fencePattern.exec(text)
    if (fence) {
      kind = 'code'
      const close = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}[ \\t]*$`)
      while (endIndex < lines.length && !close.test(lineText(lines[endIndex]!))) endIndex += 1
      if (endIndex < lines.length) endIndex += 1
    } else if (indent >= 4 && !(list && activeList)) {
      kind = 'code'
      while (endIndex < lines.length && (!lineText(lines[endIndex]!).trim() || indentation(lineText(lines[endIndex]!)) >= 4)) endIndex += 1
    } else if (list) {
      kind = 'listItem'
      activeList = true
    } else if (heading) {
      kind = 'heading'
    } else if (endIndex < lines.length && text.includes('|') && tableDelimiter(lineText(lines[endIndex]!))) {
      kind = 'table'
      endIndex += 1
      while (endIndex < lines.length && lineText(lines[endIndex]!).trim() && lineText(lines[endIndex]!).includes('|')) endIndex += 1
    } else if (/^ {0,3}(?:<!--|<\/?[A-Za-z]|<\?|>)/.test(text) || /^[ \t]*:{3,}/.test(text)) {
      kind = 'opaque'
      if (/^ {0,3}<!--/.test(text)) {
        while (!lineText(lines[endIndex - 1]!).includes('-->') && endIndex < lines.length) endIndex += 1
      } else if (/^[ \t]*:{3,}/.test(text)) {
        while (endIndex < lines.length && !/^[ \t]*:{3,}[ \t]*$/.test(lineText(lines[endIndex]!))) endIndex += 1
        if (endIndex < lines.length) endIndex += 1
      } else {
        const rawTag = /^ {0,3}<(script|style|pre)(?:[ \t>])/i.exec(text)
        if (rawTag) {
          const closing = new RegExp(`</${rawTag[1]}>`, 'i')
          while (!closing.test(lineText(lines[endIndex - 1]!)) && endIndex < lines.length) endIndex += 1
        } else while (endIndex < lines.length && lineText(lines[endIndex]!).trim()) endIndex += 1
      }
    } else {
      while (endIndex < lines.length) {
        const next = lineText(lines[endIndex]!)
        if (!next.trim() || standaloneMarker(next) || standaloneObsidian(next) || listPattern.test(next)
          || headingPattern.test(next) || fencePattern.test(next) || indentation(next) >= 4
          || /^ {0,3}(?:<!--|<\/?[A-Za-z]|<\?|>)/.test(next) || /^[ \t]*:{3,}/.test(next)
          || (next.includes('|') && endIndex + 1 < lines.length && tableDelimiter(lineText(lines[endIndex + 1]!)))) break
        endIndex += 1
      }
    }
    const end = lines[endIndex - 1]!.end
    const block: RetainedBlock = { kind, range: { start: lineStart(line), end },
      text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(source.bytes.slice(lineStart(line), end)),
      indent, anchors: [...pending], identity: 'unanchored' }
    pending = []
    if (kind !== 'code' && kind !== 'opaque') {
      for (let row = index; row < endIndex; row += 1) {
        const current = lines[row]!, parsed = inlineAnchors(lineText(current), lineStart(current))
        block.anchors.push(...parsed.anchors)
        diagnostics.push(...parsed.diagnostics)
      }
    } else if (kind === 'opaque' && /^[ \t]*<!--\s*block:/.test(text)) {
      // A broken or inline leading ROX marker is still diagnosed/retained;
      // strings inside unrelated opaque extension bodies are never interpreted.
      const parsed = inlineAnchors(text, lineStart(line))
      block.anchors.push(...parsed.anchors)
      diagnostics.push(...parsed.diagnostics)
    }
    if (kind === 'heading') block.headingLevel = heading![1]!.length
    if (kind === 'listItem') {
      let content = list![4]!, offset = text.length - content.length
      const checkbox = /^\[([ xX])\](?:[ \t]+|$)/.exec(content)
      if (checkbox) { offset += checkbox[0].length; content = content.slice(checkbox[0].length) }
      const marker = list![2]!, ordered = /^\d/.test(marker)
      block.list = { marker, ordered, contentIndent: indentation(list![3]!, indent + marker.length),
        ...(ordered ? { ordinal: Number.parseInt(marker, 10) } : {}),
        ...(checkbox ? { checkbox: checkbox[1]!.toLowerCase() === 'x' } : {}), text: cleanInline(content),
        textRange: { start: lineStart(line) + byteOffset(text, offset), end: line.contentEnd } }
    }
    blocks.push(block)
    if (kind !== 'listItem' && indent === 0) activeList = false
    index = endIndex
  }
  flushPending()
  return { blocks, diagnostics }
}

export function projectBlockIdentity(input: RetainedSource, scope: { authorityEpoch?: number; markerMappingVersion?: number } = {}): BlockIdentityProjection {
  const authorityEpoch = scope.authorityEpoch ?? 1
  const base: BlockIdentityProjection = { status: 'ok', version: 1, markerMappingVersion: 1, authorityEpoch,
    sourceHash: input.sourceHash, blocks: [], mappings: [], diagnostics: [] }
  if (!Number.isSafeInteger(authorityEpoch) || authorityEpoch < 1 || (scope.markerMappingVersion !== undefined && scope.markerMappingVersion !== 1)) {
    return { ...base, status: 'readOnly', code: 'unknownFormat' }
  }
  if (retainedSourceHash(input.bytes) !== input.sourceHash) return { ...base, status: 'readOnly', code: 'conflict' }
  const source = retainSource(input.bytes)
  if (source.diagnostics.length) return { ...base, status: 'readOnly', code: 'unknownFormat', diagnostics: source.diagnostics.map(diagnostic => ({
    code: 'unsupportedSource', range: diagnostic.range,
  })) }
  const { blocks, diagnostics } = scanBlocks(source)
  const owners = new Map<string, RetainedBlock>()
  for (const block of blocks) {
    for (const kind of ['rox', 'obsidian'] as const) {
      const sameKind = block.anchors.filter(anchor => anchor.kind === kind)
      if (sameKind.length > 1) {
        block.identity = 'ambiguous'
        diagnostics.push({ code: 'multipleMarkers', range: sameKind[0]!.range, otherRange: sameKind[1]!.range })
      }
    }
    for (const anchor of block.anchors) {
      const prior = owners.get(anchor.id)
      if (prior && prior !== block) {
        block.identity = prior.identity = 'ambiguous'
        diagnostics.push({ code: 'duplicateId', id: anchor.id, range: anchor.range,
          otherRange: prior.anchors.find(value => value.id === anchor.id)!.range })
      } else owners.set(anchor.id, block)
    }
  }
  const mappings: MarkerMapping[] = []
  for (const block of blocks) {
    if (!block.anchors.length || block.identity === 'ambiguous') continue
    block.nodeId = (block.anchors.find(anchor => anchor.kind === 'rox') ?? block.anchors[0])!.id
    block.identity = 'anchored'
    for (const anchor of block.anchors) mappings.push({ markerMappingVersion: 1, blockId: anchor.id, nodeId: block.nodeId,
      kind: anchor.kind, markerRange: { ...anchor.range }, blockRange: { ...block.range } })
  }
  return { ...base, ...(diagnostics.length ? { status: 'readOnly' as const,
    code: diagnostics.some(value => value.code === 'duplicateId') ? 'conflict' as const : 'validation' as const } : {}),
    blocks, mappings, diagnostics }
}

function markerText(source: RetainedSource, block: RetainedBlock, id: string): string {
  const line = source.lines.find(value => block.range.start >= value.start && block.range.start < value.end)
  const indent = line ? /^[ \t]*/.exec(lineText(line))![0] : ''
  const eol = line?.eol || source.lines.find(value => value.eol)?.eol || '\n'
  return `${indent}<!-- block:${id} -->${eol}`
}
/** Prepare insertions after frontmatter; allocation is never a side effect of a query. */
export function previewMarkerMapping(input: RetainedSource, policy: MarkerMappingPolicy): MarkerMappingPreview | RawSpanError {
  if (!policy || !Number.isSafeInteger(policy.authorityEpoch) || policy.authorityEpoch < 1
    || (policy.scope !== undefined && policy.scope !== 'listTree' && policy.scope !== 'allBlocks')
    || (policy.generateId !== undefined && typeof policy.generateId !== 'function')) {
    return { status: 'error', code: 'validation' }
  }
  if (policy.expectedSourceHash !== undefined && policy.expectedSourceHash !== input.sourceHash) return { status: 'error', code: 'conflict' }
  const projection = projectBlockIdentity(input, policy)
  if (projection.status !== 'ok') return { status: 'error', code: projection.code ?? 'unknownFormat' }
  const source = retainSource(input.bytes)
  const root = projection.blocks.find(block => block.kind === 'heading' && block.headingLevel === 1)
  const selected = projection.blocks.filter(block => block.identity === 'unanchored'
    && (policy.scope === 'allBlocks' || block.kind === 'listItem' || block === root))
  const used = new Set(projection.blocks.flatMap(block => block.anchors.map(anchor => anchor.id)))
  const generate = policy.generateId ?? (() => `b_${globalThis.crypto.randomUUID().replaceAll('-', '')}`)
  const addedMarkers: MarkerMappingPreview['addedMarkers'] = []
  for (const block of selected) {
    let id = ''
    for (let attempt = 0; attempt < 16; attempt += 1) {
      let candidate: string
      try { candidate = generate() } catch { return { status: 'error', code: 'validation' } }
      if (typeof candidate !== 'string' || !idPattern.test(candidate)) return { status: 'error', code: 'validation' }
      if (!used.has(candidate)) { id = candidate; break }
    }
    if (!id) return { status: 'error', code: 'conflict' }
    used.add(id)
    addedMarkers.push({ id, blockRange: { ...block.range } })
  }
  const preview = previewRawSpanPatches(source, addedMarkers.map(marker => ({ start: marker.blockRange.start,
    end: marker.blockRange.start, expected: '', replacement: markerText(source,
      selected.find(block => block.range.start === marker.blockRange.start)!, marker.id) })), {
    expectedSourceHash: policy.expectedSourceHash,
    purpose: { kind: 'markerMapping', markerMappingVersion: 1, authorityEpoch: policy.authorityEpoch },
  })
  if ('status' in preview) return preview
  const reviewed: MarkerMappingPreview = { ...preview, authorityEpoch: policy.authorityEpoch, markerMappingVersion: 1, addedMarkers }
  const checked = applyMarkerMapping(input, reviewed, policy.authorityEpoch)
  return checked.status === 'ok' ? reviewed : checked
}

export function applyMarkerMapping(current: RetainedSource, preview: MarkerMappingPreview, authorityEpoch: number): RawSpanResult {
  if (!preview || preview.markerMappingVersion !== 1 || preview.purpose?.kind !== 'markerMapping'
    || preview.purpose.authorityEpoch !== preview.authorityEpoch || !Array.isArray(preview.addedMarkers)) {
    return { status: 'error', code: 'validation' }
  }
  if (authorityEpoch !== preview.authorityEpoch) return { status: 'error', code: 'conflict' }
  const applied = applyRawSpanPatches(current, preview)
  if (applied.status !== 'ok') return applied
  const before = projectBlockIdentity(current, { authorityEpoch })
  if (before.status !== 'ok') return { status: 'error', code: before.code ?? 'unknownFormat' }
  if (preview.addedMarkers.length !== preview.patches.length) return { status: 'error', code: 'validation' }
  const source = retainSource(current.bytes), seen = new Set<string>()
  for (let index = 0; index < preview.addedMarkers.length; index += 1) {
    const marker = preview.addedMarkers[index]!, patch = preview.patches[index]!
    if (!marker || typeof marker.id !== 'string' || !idPattern.test(marker.id) || seen.has(marker.id)) return { status: 'error', code: 'validation' }
    seen.add(marker.id)
    const block = before.blocks.find(value => value.range.start === marker.blockRange?.start && value.range.end === marker.blockRange?.end)
    if (!block || block.identity !== 'unanchored' || patch.start !== block.range.start || patch.end !== patch.start
      || patch.expected !== '' || patch.replacement !== markerText(source, block, marker.id)) return { status: 'error', code: 'validation' }
  }
  const after = projectBlockIdentity(retainSource(applied.bytes), { authorityEpoch })
  if (after.status !== 'ok' || preview.addedMarkers.some(marker => !after.mappings.some(mapping => mapping.nodeId === marker.id))
    || before.mappings.some(old => !after.mappings.some(mapping => mapping.blockId === old.blockId && mapping.nodeId === old.nodeId))) {
    return { status: 'error', code: 'validation' }
  }
  return applied
}
