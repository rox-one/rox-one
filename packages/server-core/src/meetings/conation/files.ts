/**
 * RMA-I023 / #379 leftover — DSS files. Existing read-only client does not prove
 * upload/move. Path is not identity. Unsigned writes are blocked. Timeouts
 * reconcile, not retry-as-new. Live DSS writes stay blocked (evidence U1; L4 NOT_RUN).
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
  if (!write.allowed) return blocked('dss-conation-unconfirmed')
  if (!file.signed) return denied('unsigned-write')
  if (options.corrupt) return denied('corrupt-upload')
  if (options.timeout) return unknownEffect('upload-timeout')
  return blocked('dss-upload-not-live')
}

export function moveFile(store: FileStore, id: string, nextPath: string): MeetingOpResult<string, FileRecord> {
  const write = confirmWrite({ moduleId: 'dss-drive', operation: 'move', authPresent: true })
  if (!write.allowed) return blocked('dss-conation-unconfirmed')
  const existing = store.byId.get(id)
  if (!existing) return denied('not_found')
  return blocked('dss-move-not-live')
}
