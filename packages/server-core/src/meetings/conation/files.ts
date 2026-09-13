/**
 * RMA-I023 / #379 — DSS files. Existing read-only client does not prove upload/move.
 * Path is not identity. Unsigned writes are blocked. Timeouts reconcile, not retry-as-new.
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, unknownEffect, type MeetingOpResult } from '../types.ts'

export type FileRecord = {
  readonly id: string
  readonly path: string
  readonly contentSha256: string
  readonly accountId: string
  readonly revision: string
  readonly signed: boolean
}

export type FileStore = {
  files: Map<string, FileRecord>
  byId: Map<string, FileRecord>
}

export function createFileStore(files: readonly FileRecord[] = []): FileStore {
  return {
    files: new Map(files.map((file) => [file.path, file])),
    byId: new Map(files.map((file) => [file.id, file])),
  }
}

export function listFiles(store: FileStore, page: number, pageSize = 1): FileRecord[] {
  return [...store.byId.values()].slice(page * pageSize, (page + 1) * pageSize)
}

export function uploadFile(
  store: FileStore,
  file: FileRecord,
  options: { readonly timeout?: boolean; readonly corrupt?: boolean },
): MeetingOpResult<string, FileRecord> {
  const write = confirmWrite({
    moduleId: 'dss-drive',
    operation: 'upload',
    authPresent: true,
  })
  if (!write.allowed) return blocked('unsigned-or-unconfirmed-write')
  if (!file.signed) return denied('unsigned-write')
  if (options.corrupt) return denied('corrupt-upload')
  if (options.timeout) return unknownEffect('upload-timeout')
  store.files.set(file.path, file)
  store.byId.set(file.id, file)
  return { status: 'verified', reason: 'uploaded', live: false, evidenceLevel: 'C2', payload: file }
}

export function moveFile(store: FileStore, id: string, nextPath: string): MeetingOpResult<string, FileRecord> {
  const write = confirmWrite({ moduleId: 'dss-drive', operation: 'move', authPresent: true })
  if (!write.allowed) return blocked('unconfirmed-move')
  const existing = store.byId.get(id)
  if (!existing) return denied('not_found')
  store.files.delete(existing.path)
  const moved = { ...existing, path: nextPath }
  store.byId.set(id, moved)
  store.files.set(nextPath, moved)
  return { status: 'verified', reason: 'moved', live: false, evidenceLevel: 'C2', payload: moved }
}
