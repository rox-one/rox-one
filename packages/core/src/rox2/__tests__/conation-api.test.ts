import { describe, expect, test } from 'bun:test'
import {
  ROX2_SCHEMA_VERSION,
  type Rox2TypedRecord,
} from '../platform-contract.ts'
import {
  CONATION_API_SCHEMA_VERSION,
  CONATION_CONFIRMED_OPERATIONS,
  applyConationWrite,
  ingestConationRecord,
  isConfirmedConationRead,
  resolveConationOperation,
  type ConationRecordStore,
} from '../conation-api.ts'

function memoryStore(): ConationRecordStore & { data: Map<string, Rox2TypedRecord> } {
  const data = new Map<string, Rox2TypedRecord>()
  return {
    data,
    get(id) {
      return data.get(id)
    },
    set(id, record) {
      data.set(id, record)
    },
  }
}

const validNote = {
  schemaVersion: ROX2_SCHEMA_VERSION,
  kind: 'note',
  system: { id: 'n1', workspaceId: 'ws-1', displayName: 'Daily', updatedAt: 1 },
  properties: { body: 'hello' },
  soupColor: 'kept',
}

describe('ROX-AUD-012 Conation API catalog', () => {
  test('pins a versioned confirmed read set and does not claim writes as live', () => {
    expect(CONATION_API_SCHEMA_VERSION).toBe(1)
    expect(CONATION_CONFIRMED_OPERATIONS.every((op) => op.kind === 'read')).toBe(true)
    expect(isConfirmedConationRead('soup.ping')).toBe(true)
    expect(isConfirmedConationRead('soup.queryUserSoupPage')).toBe(true)
    expect(isConfirmedConationRead('dss.listEntries')).toBe(true)
    expect(resolveConationOperation('soup.mutate')).toEqual({
      status: 'blocked',
      reason: 'CompleteMutationRoot is not a confirmed write schema',
    })
    expect(resolveConationOperation('soup.subscribe').status).toBe('blocked')
    expect(resolveConationOperation('drive.upload').status).toBe('blocked')
    expect(resolveConationOperation('mail.send').status).toBe('blocked')
    expect(resolveConationOperation('fund.teleport').status).toBe('unknown')
  })

  test('ingest keeps unknown fields and refuses incompatible versions without mutating the store', () => {
    const store = memoryStore()
    const ok = ingestConationRecord(store, 'note:n1', validNote)
    expect(ok.status).toBe('ok')
    if (ok.status === 'ok') {
      expect(ok.record.properties.body).toBe('hello')
      expect(ok.record.unknownFields?.soupColor).toBe('kept')
    }
    expect(store.data.has('note:n1')).toBe(true)

    const future = { schemaVersion: ROX2_SCHEMA_VERSION + 9, kind: 'note', payload: { body: 'keep-me' } }
    const rejected = ingestConationRecord(store, 'note:n2', future)
    expect(rejected).toEqual({ status: 'rejected', code: 'unsupported-version', preserved: future })
    expect(store.data.has('note:n2')).toBe(false)
    expect(store.data.get('note:n1')?.properties.body).toBe('hello')
  })

  test('write adapter is fail-closed even for confirmed read ids', () => {
    const store = memoryStore()
    ingestConationRecord(store, 'note:n1', validNote)
    const write = applyConationWrite(store, 'soup.mutate', { title: 'overwrite' })
    expect(write.status).toBe('rejected')
    if (write.status === 'rejected') {
      expect(write.code).toBe('blocked-write')
      expect(write.preserved).toEqual({ title: 'overwrite' })
    }
    expect(store.data.get('note:n1')?.properties.body).toBe('hello')
    const disguised = applyConationWrite(store, 'soup.ping', { hack: true })
    expect(disguised.status).toBe('rejected')
    expect(store.data.size).toBe(1)
  })
})
