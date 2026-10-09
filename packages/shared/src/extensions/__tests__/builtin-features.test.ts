import { describe, expect, it } from 'bun:test'
import {
  BUILTIN_FIRST_PARTY_RECORDS,
  BUILTIN_CLIPBOARD_HISTORY_ID,
  BUILTIN_KNOWLEDGE_MAP_ID,
  mergeBuiltinFirstPartyRecords,
} from '../builtin-features.ts'
import { parseExtensionManifest } from '../manifest.ts'
import type { ExtensionRecord } from '../types.ts'

describe('builtin first-party extension records', () => {
  it('parses both records through parseExtensionManifest', () => {
    for (const record of BUILTIN_FIRST_PARTY_RECORDS) {
      const manifest = parseExtensionManifest(record.manifest)
      expect(manifest.runtime).toBe('craft-native')
      expect(manifest.permissions).toEqual(['ui.panel', 'ui.command'])
    }
  })

  it('declares both records enabled', () => {
    expect(BUILTIN_FIRST_PARTY_RECORDS.every((r) => r.status === 'enabled')).toBe(true)
  })

  it('uses unique ids', () => {
    const ids = BUILTIN_FIRST_PARTY_RECORDS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(BUILTIN_CLIPBOARD_HISTORY_ID)
    expect(ids).toContain(BUILTIN_KNOWLEDGE_MAP_ID)
  })
})

describe('mergeBuiltinFirstPartyRecords', () => {
  it('appends every builtin to an empty record list', () => {
    expect(mergeBuiltinFirstPartyRecords([])).toEqual(BUILTIN_FIRST_PARTY_RECORDS)
  })

  it('de-dupes by id with the existing record winning and preserving order', () => {
    const base = BUILTIN_FIRST_PARTY_RECORDS[0]!
    const existing: ExtensionRecord = {
      ...base,
      status: 'disabled',
    }
    const merged = mergeBuiltinFirstPartyRecords([existing])
    expect(merged[0]).toBe(existing)
    expect(merged[0]!.status).toBe('disabled')
    expect(merged.filter((r) => r.id === BUILTIN_CLIPBOARD_HISTORY_ID)).toHaveLength(1)
    expect(merged.map((r) => r.id)).toContain(BUILTIN_KNOWLEDGE_MAP_ID)
  })
})