/** W1-06 (#1503) — In-memory reference backend (tests, `InMemoryCommandStore`). */

import type { RecordBackend, RecordWrite, StoredRecord } from '../types'

type Collections = Map<string, Map<string, StoredRecord>>
const WORKSPACES = new Map<string, Collections>()

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function resetReferenceMemory(workspaceId?: string): void {
  if (workspaceId) WORKSPACES.delete(workspaceId)
  else WORKSPACES.clear()
}

/** Test helper: every record of one collection. */
export function referenceMemoryRecords(workspaceId: string, collection: string): StoredRecord[] {
  return [...(WORKSPACES.get(workspaceId)?.get(collection)?.values() ?? [])].map(clone)
}

export class MemoryRecordBackend implements RecordBackend {
  readonly name = 'memory' as const
  private readonly collections: Collections

  constructor(workspaceId: string) {
    let collections = WORKSPACES.get(workspaceId)
    if (!collections) WORKSPACES.set(workspaceId, (collections = new Map()))
    this.collections = collections
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    const record = this.collections.get(collection)?.get(id)
    return record ? clone(record) : null
  }

  async put(write: RecordWrite) {
    let rows = this.collections.get(write.collection)
    if (!rows) this.collections.set(write.collection, (rows = new Map()))
    const current = rows.get(write.id) ?? null
    if ((current?.revision ?? null) !== write.expectedRevision) return { status: 'conflict' as const, current: current ? clone(current) : null }
    const revision = (current?.revision ?? 0) + 1
    rows.set(write.id, { id: write.id, revision, data: clone(write.data) })
    return { status: 'accepted' as const, revision }
  }

  async remove(collection: string, id: string): Promise<boolean> {
    return this.collections.get(collection)?.delete(id) ?? false
  }
}
