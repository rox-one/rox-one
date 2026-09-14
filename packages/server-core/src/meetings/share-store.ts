/**
 * File-backed meeting share/export records (I032).
 * Canonical Notes/Tasks are not stored here — only meeting links and spans.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MeetingShareRecord } from './sharing.ts'

const FILE = 'share-index.json'

function isRecord(value: unknown): value is MeetingShareRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as MeetingShareRecord
  return typeof record.meetingId === 'string' && typeof record.workspaceId === 'string'
}

export async function loadMeetingShareIndex(dir: string): Promise<MeetingShareRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, FILE), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord)
  } catch {
    return []
  }
}

export async function saveMeetingShareIndex(dir: string, records: MeetingShareRecord[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, FILE), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}
