import { projectBlockIdentity, type BlockIdentityDiagnostic, type MarkerMapping, type RetainedBlock } from './block-identity.ts'
import { retainedText, utf8Text, type RetainedSource, type SourceRange } from './retained-source.ts'

export type ListNode = {
  nodeId?: string
  identity: RetainedBlock['identity']
  sourceRange: SourceRange
  textRange: SourceRange
  text: string
  indent: number
  level: number
  marker: string
  ordered: boolean
  ordinal?: number
  checkbox?: boolean
  /** Flat index disambiguates unanchored/duplicate rows without inventing a durable ID. */
  blockIndex: number
  parentIndex: number | null
  parentNodeId?: string | null
  children: ListNode[]
}
export type ListTreeProjection = {
  status: 'ok' | 'readOnly'
  code?: 'validation' | 'conflict' | 'unknownFormat'
  version: 1
  markerMappingVersion: 1
  authorityEpoch: number
  sourceHash: string
  root?: { nodeId?: string; identity: RetainedBlock['identity']; text: string; sourceRange: SourceRange }
  nodes: ListNode[]
  roots: ListNode[]
  mappings: MarkerMapping[]
  /** These bytes are absent from the list view, and remain owned by Markdown. */
  retainedRegions: SourceRange[]
  diagnostics: Array<BlockIdentityDiagnostic | { code: 'unsupportedIndent'; range: SourceRange }>
}

function headingText(source: RetainedSource, block: RetainedBlock): string {
  let cursor = block.range.start
  const pieces: string[] = []
  for (const anchor of block.anchors.filter(value => value.range.start >= block.range.start && value.range.end <= block.range.end)
    .sort((a, b) => a.range.start - b.range.start)) {
    pieces.push(retainedText(source, { start: cursor, end: anchor.range.start }))
    cursor = anchor.range.end
  }
  pieces.push(retainedText(source, { start: cursor, end: block.range.end }))
  return pieces.join('').replace(/^ {0,3}#{1,6}[ \t]+/, '').trim().replace(/[ \t]+#+[ \t]*$/, '')
}
function retainedComplement(length: number, projected: SourceRange[]): SourceRange[] {
  let start = 0
  const regions: SourceRange[] = []
  for (const range of projected.sort((a, b) => a.start - b.start)) {
    if (start < range.start) regions.push({ start, end: range.start })
    start = Math.max(start, range.end)
  }
  if (start < length) regions.push({ start, end: length })
  return regions
}

/** A source-revision-bound view, never a writable duplicate of the Markdown tree. */
export function projectListTree(source: RetainedSource, scope: { authorityEpoch?: number; markerMappingVersion?: number } = {}): ListTreeProjection {
  const identity = projectBlockIdentity(source, scope)
  const result: ListTreeProjection = { status: identity.status, ...(identity.code ? { code: identity.code } : {}),
    version: 1, markerMappingVersion: 1, authorityEpoch: identity.authorityEpoch, sourceHash: identity.sourceHash,
    nodes: [], roots: [], mappings: identity.mappings, retainedRegions: [], diagnostics: [...identity.diagnostics] }
  const title = identity.blocks.find(block => block.kind === 'heading' && block.headingLevel === 1)
  if (title) result.root = { nodeId: title.nodeId, identity: title.identity, text: headingText(source, title), sourceRange: { ...title.range } }
  const stack: Array<{ node: ListNode; flatIndex: number; contentIndent: number }> = []
  for (const [blockIndex, block] of identity.blocks.entries()) {
    if (!block.list) {
      // A new top-level prose block starts a separate list, while attached
      // indented prose/code remains outside the tree and keeps its source bytes.
      if (block.indent === 0) stack.length = 0
      continue
    }
    while (stack.length && stack.at(-1)!.node.indent >= block.indent) stack.pop()
    const parent = stack.at(-1)
    if (parent && block.indent < parent.contentIndent) {
      result.status = 'readOnly'
      result.code = 'unknownFormat'
      result.diagnostics.push({ code: 'unsupportedIndent', range: { ...block.range } })
    }
    const node: ListNode = { nodeId: block.nodeId, identity: block.identity, sourceRange: { ...block.range },
      textRange: { ...block.list.textRange }, text: block.list.text, indent: block.indent, level: stack.length,
      marker: block.list.marker, ordered: block.list.ordered,
      ...(block.list.ordinal !== undefined ? { ordinal: block.list.ordinal } : {}),
      ...(block.list.checkbox !== undefined ? { checkbox: block.list.checkbox } : {}), blockIndex,
      parentIndex: parent?.flatIndex ?? null, parentNodeId: parent ? parent.node.nodeId : result.root ? result.root.nodeId : null,
      children: [] }
    if (parent) parent.node.children.push(node)
    else result.roots.push(node)
    result.nodes.push(node)
    stack.push({ node, flatIndex: result.nodes.length - 1, contentIndent: block.list.contentIndent })
  }
  const projected = result.nodes.map(node => node.sourceRange)
  if (result.root) projected.push(result.root.sourceRange)
  result.retainedRegions = retainedComplement(source.bytes.length, projected)
  return result
}

/** Export is the retained authority, not serialization of the visible list projection. */
export function listTreeMarkdown(source: RetainedSource, projection: ListTreeProjection): string | { status: 'error'; code: 'conflict' | 'unknownFormat' } {
  if (projection.sourceHash !== source.sourceHash) return { status: 'error', code: 'conflict' }
  const checked = projectBlockIdentity(source, { authorityEpoch: projection.authorityEpoch, markerMappingVersion: projection.markerMappingVersion })
  if (checked.code === 'conflict') return { status: 'error', code: 'conflict' }
  try { return utf8Text(source.bytes) } catch { return { status: 'error', code: 'unknownFormat' } }
}
