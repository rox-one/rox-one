/**
 * Meeting media import (issue #360 / I004).
 * Dedupes by workspace + SHA-256. Mic denial does not block import.
 * Symlinks, empty, and oversized files fail closed.
 */

import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  authorizeMeetingAction,
  type MeetingActor,
  type MeetingGrant,
} from '@craft-agent/shared/meeting-agents'

export const MAX_MEETING_IMPORT_BYTES = 80 * 1024 * 1024

export type ImportedMeetingMedia = {
  workspaceId: string
  sha256: string
  byteLength: number
  path: string
  mimeType: string
  durationMs?: number
}

export class MeetingImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MeetingImportError'
  }
}

export class MeetingMediaArchive {
  private readonly byKey = new Map<string, ImportedMeetingMedia>()

  constructor(private readonly root: string) {}

  list(): ImportedMeetingMedia[] {
    return [...this.byKey.values()].map((item) => ({ ...item }))
  }

  async importFile(input: {
    workspaceId: string
    filePath: string
    bytes: Uint8Array
    mimeType?: string
    actor: MeetingActor
    grants: readonly MeetingGrant[]
    now: number
    durationMs?: number
    lstat?: typeof lstat
  }): Promise<ImportedMeetingMedia> {
    const auth = authorizeMeetingAction({
      actor: input.actor,
      capability: 'archive.durable',
      operation: 'import-media',
      source: 'import',
      payloadHash: sha256(input.bytes),
      now: input.now,
      permissionMode: 'ask',
      grants: input.grants,
    })
    if (!auth.ok) {
      throw new MeetingImportError(auth.code, auth.message)
    }
    if (input.bytes.byteLength === 0) {
      throw new MeetingImportError('corrupt-file', 'Imported media is empty')
    }
    if (input.bytes.byteLength > MAX_MEETING_IMPORT_BYTES) {
      throw new MeetingImportError('too-large', 'Imported media exceeds the size limit')
    }
    const st = await (input.lstat ?? lstat)(input.filePath)
    if (st.isSymbolicLink()) {
      throw new MeetingImportError('symlink', 'Imported media must not be a symlink')
    }
    const digest = sha256(input.bytes)
    const key = `${input.workspaceId}:${digest}`
    const existing = this.byKey.get(key)
    if (existing) return { ...existing }
    await mkdir(this.root, { recursive: true })
    const dest = join(this.root, `${digest}.bin`)
    await writeFile(dest, input.bytes)
    const record: ImportedMeetingMedia = {
      workspaceId: input.workspaceId,
      sha256: digest,
      byteLength: input.bytes.byteLength,
      path: dest,
      mimeType: input.mimeType ?? 'application/octet-stream',
      durationMs: input.durationMs,
    }
    this.byKey.set(key, record)
    return { ...record }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
