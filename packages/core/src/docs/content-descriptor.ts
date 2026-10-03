import { formatRox2EntityId, parseRox2EntityId, type Rox2EntityRef } from '../rox2/platform-contract.ts'

export const DOCUMENT_DESCRIPTOR_VERSION = 2

export type ContentKind = 'document' | 'base' | 'record'
export type ContentAuthority = 'markdown' | 'rich-blocks'
export type ContentEntityRef = Rox2EntityRef & { version: 2 }

/** Provenance supplied by the canonical source, never an access grant. */
export type EntityOrigin = {
  sourceStoreId: string
  nativeId: string
  ownerPrincipalId?: string
  providerConnectionId?: string
  authorityEpoch: number
}

export type EntityAlias = {
  alias: Rox2EntityRef
  canonical: ContentEntityRef
}

/** Content lives at contentRef. A page and its note alias have one native ID. */
export type DocumentDescriptor = {
  version: 2
  contentKind: ContentKind
  authority: ContentAuthority
  authorityEpoch: number
  contentRef: Rox2EntityRef
  contentRevision: string
  markerVersion: number
  exportProfile: string
}

export type DescriptorDecodeResult =
  | { status: 'ok'; descriptor: DocumentDescriptor; sourceVersion: 1 | 2; preserved: unknown }
  | { status: 'readOnly'; code: 'unknownFormat'; version: number; preserved: unknown }
  | { status: 'invalid'; code: 'validation'; preserved: unknown }

export type ContentRefDecodeResult =
  | { status: 'ok'; ref: Rox2EntityRef; sourceVersion: 1 | 2 }
  | { status: 'readOnly'; code: 'unknownFormat'; preserved: unknown }
  | { status: 'invalid'; code: 'validation'; preserved: unknown }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonempty(value)
}

/** Decode V1 references using the existing Rox2 wire fields, then additive V2. */
export function decodeContentEntityRef(raw: unknown): ContentRefDecodeResult {
  if (!record(raw)) return { status: 'invalid', code: 'validation', preserved: raw }
  const version = raw.version === undefined ? 1 : raw.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return { status: 'invalid', code: 'validation', preserved: raw }
  }
  if (version > 2) return { status: 'readOnly', code: 'unknownFormat', preserved: raw }
  if (!nonempty(raw.workspaceId) || !nonempty(raw.entityId)
    || !optionalString(raw.revisionId) || !optionalString(raw.accountNamespace)) {
    return { status: 'invalid', code: 'validation', preserved: raw }
  }
  try {
    const { kind } = parseRox2EntityId(raw.entityId)
    if (kind !== 'note' && kind !== 'page') return { status: 'invalid', code: 'validation', preserved: raw }
  } catch {
    return { status: 'invalid', code: 'validation', preserved: raw }
  }
  return {
    status: 'ok',
    sourceVersion: version as 1 | 2,
    ref: {
      workspaceId: raw.workspaceId,
      entityId: raw.entityId,
      ...(raw.revisionId === undefined ? {} : { revisionId: raw.revisionId as string }),
      ...(raw.accountNamespace === undefined ? {} : { accountNamespace: raw.accountNamespace as string }),
    },
  }
}

export function isEntityOrigin(value: unknown): value is EntityOrigin {
  if (!record(value)) return false
  return nonempty(value.sourceStoreId) && nonempty(value.nativeId)
    && optionalString(value.ownerPrincipalId) && optionalString(value.providerConnectionId)
    && typeof value.authorityEpoch === 'number'
    && Number.isSafeInteger(value.authorityEpoch) && value.authorityEpoch >= 0
}

/** Keys include source account and workspace; revisions do not change identity. */
export function contentEntityKey(ref: Rox2EntityRef): string {
  return JSON.stringify([ref.workspaceId, ref.accountNamespace ?? null, ref.entityId])
}

export function contentOriginKey(origin: EntityOrigin): string {
  return JSON.stringify([origin.sourceStoreId, origin.ownerPrincipalId ?? null,
    origin.providerConnectionId ?? null, origin.nativeId])
}

export function sameContentIdentity(left: Rox2EntityRef, right: Rox2EntityRef): boolean {
  return contentEntityKey(left) === contentEntityKey(right)
}

/** Canonicalizing a legacy route changes only its kind, never the native ID. */
export function canonicalPageRef(raw: Rox2EntityRef): ContentEntityRef {
  const parsed = decodeContentEntityRef(raw)
  if (parsed.status !== 'ok') throw new Error('Invalid content reference')
  const { id } = parseRox2EntityId(parsed.ref.entityId)
  return { ...parsed.ref, version: 2, entityId: formatRox2EntityId('page', id) }
}

export function legacyNoteAlias(raw: Rox2EntityRef): Rox2EntityRef {
  const canonical = canonicalPageRef(raw)
  const { id } = parseRox2EntityId(canonical.entityId)
  const { version: _version, ...ref } = canonical
  return { ...ref, entityId: formatRox2EntityId('note', id) }
}

/**
 * Keep the original payload (including exact JSON bytes) for unsupported data.
 * V1 format descriptors predate contentKind; they describe a document.
 * Parsing alone neither installs an owner nor permits a format conversion.
 */
export function decodeDocumentDescriptor(payload: unknown): DescriptorDecodeResult {
  let raw = payload
  if (typeof payload === 'string') {
    try { raw = JSON.parse(payload) } catch { return { status: 'invalid', code: 'validation', preserved: payload } }
  }
  if (!record(raw)) return { status: 'invalid', code: 'validation', preserved: payload }
  const version = raw.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return { status: 'invalid', code: 'validation', preserved: payload }
  }
  if (version > DOCUMENT_DESCRIPTOR_VERSION) {
    return { status: 'readOnly', code: 'unknownFormat', version, preserved: payload }
  }
  const contentKind = version === 1 ? (raw.contentKind ?? 'document') : raw.contentKind
  const contentRef = decodeContentEntityRef(raw.contentRef)
  if (contentRef.status !== 'ok'
    || !['document', 'base', 'record'].includes(contentKind as string)
    || !['markdown', 'rich-blocks'].includes(raw.authority as string)
    || typeof raw.authorityEpoch !== 'number' || !Number.isSafeInteger(raw.authorityEpoch) || raw.authorityEpoch < 0
    || !nonempty(raw.contentRevision)
    || typeof raw.markerVersion !== 'number' || !Number.isSafeInteger(raw.markerVersion) || raw.markerVersion < 1
    || !nonempty(raw.exportProfile)) {
    return { status: 'invalid', code: 'validation', preserved: payload }
  }
  return {
    status: 'ok', sourceVersion: version as 1 | 2, preserved: payload,
    descriptor: {
      version: 2, contentKind: contentKind as ContentKind, authority: raw.authority as ContentAuthority,
      authorityEpoch: raw.authorityEpoch, contentRef: contentRef.ref,
      contentRevision: raw.contentRevision, markerVersion: raw.markerVersion, exportProfile: raw.exportProfile,
    },
  }
}

export function legacyDocumentDescriptor(input: {
  ref: Rox2EntityRef
  contentRevision: string
  authorityEpoch: number
}): DocumentDescriptor {
  const descriptor: DocumentDescriptor = {
    version: 2, contentKind: 'document', authority: 'markdown', authorityEpoch: input.authorityEpoch,
    contentRef: input.ref, contentRevision: input.contentRevision, markerVersion: 1, exportProfile: 'markdown',
  }
  if (decodeDocumentDescriptor(descriptor).status !== 'ok') throw new Error('Invalid legacy descriptor')
  return descriptor
}
