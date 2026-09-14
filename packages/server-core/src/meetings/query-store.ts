/**
 * File-backed meeting query index (issue #368 / I012).
 * Tombstones stay in the file so a deleted meeting is never an empty archive.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MeetingQueryRecord } from './queries.ts'

const FILE = 'query-index.json'

function isRecord(value: unknown): value is MeetingQueryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as MeetingQueryRecord
  return typeof record.id === 'string' && typeof record.workspaceId === 'string' && typeof record.title === 'string'
}

export async function loadMeetingQueryIndex(dir: string): Promise<MeetingQueryRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, FILE), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord)
  } catch {
    return []
  }
}

export async function saveMeetingQueryIndex(dir: string, records: MeetingQueryRecord[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, FILE), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}
