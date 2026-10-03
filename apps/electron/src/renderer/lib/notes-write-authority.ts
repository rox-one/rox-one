import type { NoteDocument } from '../../shared/types'

/** Only authenticated descriptor projections can select a non-native owner. */
export type NotesWriteProjection = {
  status: 'ok' | 'readOnly'
  canonicalRef: { workspaceId: string }
  origin: { nativeId: string; sourceStoreId: string; authorityEpoch: number }
  revision: string
  capabilities: { write: boolean }
} | { status: 'error' } | null

export function isNativeNoteDocument(note: NoteDocument): boolean {
  return note.nativeId !== undefined || note.nativeRevision !== undefined ||
    note.sourceStoreId?.startsWith('native-journal:') === true
}

function refuse(message: string, code: string): never {
  throw Object.assign(new Error(message), { code })
}

/** A projection adds metadata; it cannot replace the native mutation authority. */
export async function writeNoteThroughAuthority<T>(
  note: NoteDocument,
  workspaceId: string,
  projection: NotesWriteProjection,
  writers: { native: () => Promise<T>; markdown: () => Promise<T> },
): Promise<T> {
  const native = isNativeNoteDocument(note)
  if (native && (!note.nativeId || !Number.isSafeInteger(note.nativeRevision) || note.nativeRevision! < 1)) {
    refuse('Native Notes requires its immutable identity and opened revision', 'DOCUMENT_VALIDATION_FAILED')
  }
  if (projection !== null) {
    if (projection.status !== 'ok' || !projection.capabilities.write) {
      refuse('Notes source does not grant editing authority', 'AUTH_FAILED')
    }
    if (projection.canonicalRef.workspaceId !== workspaceId ||
        projection.origin.nativeId !== (native ? note.nativeId : note.id) ||
        !note.sourceStoreId || projection.origin.sourceStoreId !== note.sourceStoreId ||
        !Number.isSafeInteger(projection.origin.authorityEpoch) || projection.origin.authorityEpoch < 1 ||
        projection.origin.sourceStoreId.startsWith('native-journal:') !== native) {
      refuse('Notes canonical source changed before write', 'DOCUMENT_AUTHORITY_CHANGED')
    }
    if (!note.revision || projection.revision !== note.revision) {
      refuse('Notes opened content revision changed before write', 'HASH_CONFLICT')
    }
  } else if (!native) {
    refuse('Notes non-native writer requires an authenticated source binding', 'DOCUMENT_AUTHORITY_CHANGED')
  }
  // Rejections and transport failures propagate directly. There is no fallback writer.
  return native ? writers.native() : writers.markdown()
}
