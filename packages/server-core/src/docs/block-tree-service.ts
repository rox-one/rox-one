import {
  applyMarkerMapping, decodeContentEntityRef, decodeMarkdownCommitCommand, MarkdownCommitError,
  previewMarkerMapping, projectBlockIdentity, projectListTree, retainSource, retainedSourceHash,
  type BlockIdentityProjection, type ListTreeProjection, type MarkdownCommitCommand, type MarkerMappingPreview,
} from '../../../core/src/docs/index.ts'
import { parseRox2EntityId, type Rox2EntityRef } from '../../../core/src/rox2/platform-contract.ts'
import type { ContentFailure, ContentResolution } from './descriptor-resolver.ts'
import type { MarkdownCommitReceipt } from './markdown-commit.ts'
import type { NoteDocument } from '@craft-agent/shared/protocol'

export interface GetBlockTreeRequest {
  ref: Rox2EntityRef
  revision: string
  authorityEpoch: number
  sourceStoreId: string
  markerMappingVersion?: 1
}
export interface BlockTreeResult {
  canonicalRef: Rox2EntityRef
  revision: string
  sourceHash: string
  authorityEpoch: number
  sourceStoreId: string
  identity: BlockIdentityProjection
  listTree: ListTreeProjection
}
export interface PreviewMarkerMappingRequest extends GetBlockTreeRequest {
  scope?: 'listTree' | 'allBlocks'
}
/** Exact retained base permits the same semantic validation during durable replay. */
export interface NativeMarkerMappingPreview {
  schemaVersion: 1
  ref: Rox2EntityRef
  expectedRevision: string
  authorityEpoch: number
  sourceStoreId: string
  baseContent: string
  mapping: MarkerMappingPreview
  digest: string
}
export interface ApplyMarkerMappingRequest {
  preview: NativeMarkerMappingPreview
  reviewedDigest: string
  operationId: string
}
export interface MarkerMappingCommitResult {
  note: NoteDocument
  receipt: MarkdownCommitReceipt
  blockTree: BlockTreeResult
}
export interface NativeBlockTreePorts {
  resolve(ref: Rox2EntityRef): Promise<ContentResolution | ContentFailure>
  commit(command: MarkdownCommitCommand): Promise<{ note: NoteDocument; receipt: MarkdownCommitReceipt }>
  assertSource(): Promise<void>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function fail(kind: MarkdownCommitError['kind'], message: string): never {
  throw new MarkdownCommitError(kind, message)
}
function refFrom(value: unknown): Rox2EntityRef {
  const decoded = decodeContentEntityRef(value)
  if (decoded.status !== 'ok') return fail('validation', 'Invalid document reference')
  return decoded.ref
}
function decodeRead(value: unknown): GetBlockTreeRequest {
  if (!record(value)) return fail('validation', 'Invalid block tree request')
  const ref = refFrom(value.ref)
  if (typeof value.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.revision)
    || !Number.isSafeInteger(value.authorityEpoch) || Number(value.authorityEpoch) < 1
    || typeof value.sourceStoreId !== 'string' || !value.sourceStoreId || value.sourceStoreId.length > 512
    || value.sourceStoreId.includes('\0') || (value.markerMappingVersion !== undefined && value.markerMappingVersion !== 1)) {
    return fail('validation', 'Invalid block tree revision or source binding')
  }
  if (ref.revisionId !== undefined && ref.revisionId !== value.revision) return fail('conflict', 'Document reference revision conflict')
  return { ref, revision: value.revision, authorityEpoch: Number(value.authorityEpoch), sourceStoreId: value.sourceStoreId,
    ...(value.markerMappingVersion === undefined ? {} : { markerMappingVersion: 1 }) }
}
function previewDigest(preview: Omit<NativeMarkerMappingPreview, 'digest'>): string {
  return retainedSourceHash(JSON.stringify({ schemaVersion: 1, ref: refFrom(preview.ref),
    expectedRevision: preview.expectedRevision, authorityEpoch: preview.authorityEpoch,
    sourceStoreId: preview.sourceStoreId, baseContent: preview.baseContent, mapping: preview.mapping }))
}

/** Disposable projections of one authorized Markdown authority; queries never stamp IDs. */
export function createNativeBlockTreeService(ports: NativeBlockTreePorts) {
  async function snapshot(request: GetBlockTreeRequest, requireRevision = true) {
    const { revisionId: _requestedRevision, ...identityRef } = request.ref
    const result = await ports.resolve(identityRef)
    if (result.status === 'error') return fail(result.code === 'denied' ? 'denied'
      : result.code === 'deleted' ? 'deleted' : result.code === 'conflict' ? 'conflict'
      : result.code === 'validation' ? 'validation' : 'unknownFormat', 'Document block source unavailable')
    await ports.assertSource()
    if (result.origin.sourceStoreId !== request.sourceStoreId || result.origin.authorityEpoch !== request.authorityEpoch) {
      return fail('unknownFormat', 'Document block source binding changed')
    }
    if (requireRevision && result.revision !== request.revision) return fail('conflict', 'Document block revision conflict')
    if (result.revision !== retainedSourceHash(result.content)) return fail('unknownFormat', 'Document block source hash mismatch')
    return result
  }
  function project(result: ContentResolution): BlockTreeResult {
    const source = retainSource(result.content)
    const scope = { authorityEpoch: result.origin.authorityEpoch, markerMappingVersion: 1 }
    return { canonicalRef: result.canonicalRef, revision: result.revision, sourceHash: source.sourceHash,
      authorityEpoch: result.origin.authorityEpoch, sourceStoreId: result.origin.sourceStoreId,
      identity: projectBlockIdentity(source, scope), listTree: projectListTree(source, scope) }
  }
  async function getBlockTree(raw: unknown): Promise<BlockTreeResult> {
    return project(await snapshot(decodeRead(raw)))
  }
  async function previewMapping(raw: unknown): Promise<NativeMarkerMappingPreview> {
    const request = decodeRead(raw)
    if (!record(raw) || (raw.scope !== undefined && raw.scope !== 'listTree' && raw.scope !== 'allBlocks')) {
      return fail('validation', 'Invalid marker mapping scope')
    }
    const result = await snapshot(request)
    if (!result.capabilities.write || result.status !== 'ok') return fail('denied', 'Marker mapping requires document write access')
    const mapping = previewMarkerMapping(retainSource(result.content), { authorityEpoch: request.authorityEpoch,
      expectedSourceHash: request.revision, markerMappingVersion: 1, scope: raw.scope ?? 'listTree' })
    if ('status' in mapping) return fail(mapping.code, 'Document marker mapping preview failed')
    const preview: Omit<NativeMarkerMappingPreview, 'digest'> = { schemaVersion: 1, ref: result.canonicalRef,
      expectedRevision: request.revision, authorityEpoch: request.authorityEpoch, sourceStoreId: request.sourceStoreId,
      baseContent: result.content, mapping }
    await ports.assertSource()
    return { ...preview, digest: previewDigest(preview) }
  }
  async function applyMapping(raw: unknown): Promise<MarkerMappingCommitResult> {
    if (!record(raw) || !record(raw.preview)) return fail('validation', 'Invalid marker mapping command')
    const preview = raw.preview
    const request = decodeRead({ ref: preview.ref, revision: preview.expectedRevision,
      authorityEpoch: preview.authorityEpoch, sourceStoreId: preview.sourceStoreId, markerMappingVersion: 1 })
    if (preview.schemaVersion !== 1 || typeof preview.baseContent !== 'string'
      || typeof preview.digest !== 'string' || raw.reviewedDigest !== preview.digest || !record(preview.mapping)
      || preview.baseContent.length > 16 * 1024 * 1024) return fail('validation', 'Reviewed marker mapping is required')
    const mapping = preview.mapping as unknown as MarkerMappingPreview
    const checked: NativeMarkerMappingPreview = { schemaVersion: 1, ref: request.ref, expectedRevision: request.revision,
      authorityEpoch: request.authorityEpoch, sourceStoreId: request.sourceStoreId, baseContent: preview.baseContent,
      mapping, digest: preview.digest }
    if (previewDigest(checked) !== checked.digest || retainedSourceHash(checked.baseContent) !== request.revision) {
      return fail('validation', 'Reviewed marker mapping digest mismatch')
    }
    const current = await snapshot(request, false)
    if (!current.capabilities.write || current.status !== 'ok') return fail('denied', 'Marker mapping requires document write access')
    let applied
    try { applied = applyMarkerMapping(retainSource(checked.baseContent), mapping, request.authorityEpoch) }
    catch { return fail('validation', 'Invalid marker mapping preview') }
    if (applied.status !== 'ok') return fail(applied.code, 'Reviewed marker mapping cannot be applied')
    const command = decodeMarkdownCommitCommand({ workspaceId: request.ref.workspaceId,
      noteId: parseRox2EntityId(current.ownerRef.entityId).id, expectedRevision: request.revision,
      authorityEpoch: request.authorityEpoch, sourceStoreId: request.sourceStoreId,
      operationId: raw.operationId, content: applied.text })
    const committed = await ports.commit(command)
    // The native commit includes a durable receipt and exact authoritative readback.
    const blockTree = await getBlockTree({ ...request, ref: { ...current.canonicalRef, revisionId: committed.receipt.revision }, revision: committed.receipt.revision })
    return { ...committed, blockTree }
  }
  return { getBlockTree, previewMarkerMapping: previewMapping, applyMarkerMapping: applyMapping }
}
