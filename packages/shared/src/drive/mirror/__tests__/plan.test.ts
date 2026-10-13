import { describe, expect, test } from 'bun:test'
import type { MirrorJournalRecord, MirrorSourceEntry } from '../types'
import { planMirrorDiff } from '../plan'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function sourceEntry(relativePath: string, overrides: Partial<MirrorSourceEntry> = {}): MirrorSourceEntry {
  return {
    sliceId: 'settings',
    relativePath,
    absPath: `/cfg/${relativePath}`,
    sizeBytes: 10,
    mtimeMs: 1000,
    sha256: SHA_A,
    ...overrides,
  }
}

function recordWith(entries: Record<string, { sha256: string; sizeBytes: number }>, tombstones: string[] = []): MirrorJournalRecord {
  const full: MirrorJournalRecord['entries'] = {}
  for (const [path, value] of Object.entries(entries)) full[path] = { ...value, committedAtMs: 1 }
  return { version: 1, entries: full, tombstones }
}

describe('planMirrorDiff', () => {
  test('classifies add / changed / unchanged by sha256', () => {
    const entries = [
      sourceEntry('added.json'),
      sourceEntry('changed.json', { sha256: SHA_B }),
      sourceEntry('same.json', { sha256: SHA_A }),
    ]
    const plan = planMirrorDiff(entries, recordWith({
      'changed.json': { sha256: SHA_A, sizeBytes: 10 },
      'same.json': { sha256: SHA_A, sizeBytes: 10 },
    }))

    expect(plan.add.map(e => e.relativePath)).toEqual(['added.json'])
    expect(plan.changed.map(e => e.relativePath)).toEqual(['changed.json'])
    expect(plan.unchanged.map(e => e.relativePath)).toEqual(['same.json'])
    expect(plan.tombstones).toEqual([])
  })

  test('falls back to a size comparison when the scan carries no hash', () => {
    const entries = [
      sourceEntry('empty-sha-same.json', { sha256: undefined, sizeBytes: 10 }),
      sourceEntry('empty-sha-grew.json', { sha256: undefined, sizeBytes: 11 }),
    ]
    const plan = planMirrorDiff(entries, recordWith({
      'empty-sha-same.json': { sha256: SHA_A, sizeBytes: 10 },
      'empty-sha-grew.json': { sha256: SHA_A, sizeBytes: 10 },
    }))
    expect(plan.unchanged.map(e => e.relativePath)).toEqual(['empty-sha-same.json'])
    expect(plan.changed.map(e => e.relativePath)).toEqual(['empty-sha-grew.json'])
  })

  test('reports tombstones only for journal paths missing from the catalog', () => {
    const entries = [sourceEntry('still-here.json')]
    const plan = planMirrorDiff(entries, recordWith(
      { 'still-here.json': { sha256: SHA_A, sizeBytes: 10 }, 'deleted.json': { sha256: SHA_B, sizeBytes: 4 } },
      ['deleted.json', 'still-here.json'],
    ))
    expect(plan.tombstones).toEqual(['deleted.json'])
    expect(plan.unchanged.map(e => e.relativePath)).toEqual(['still-here.json'])
  })

  test('a committed entry that vanished from disk becomes a tombstone', () => {
    const plan = planMirrorDiff([], recordWith({ 'gone.json': { sha256: SHA_A, sizeBytes: 10 } }))
    expect(plan.tombstones).toEqual(['gone.json'])
    expect(plan.add).toEqual([])
    expect(plan.changed).toEqual([])
    expect(plan.unchanged).toEqual([])
  })

  test('is deterministic regardless of input order', () => {
    const forward = [sourceEntry('b.json'), sourceEntry('a.json'), sourceEntry('c.json', { sha256: SHA_B })]
    const shuffled = [forward[2]!, forward[0]!, forward[1]!]
    const journal = recordWith({ 'c.json': { sha256: SHA_A, sizeBytes: 10 } })

    const planA = planMirrorDiff(forward, journal)
    const planB = planMirrorDiff(shuffled, journal)
    expect(planA.add.map(e => e.relativePath)).toEqual(['a.json', 'b.json'])
    expect(planB.add.map(e => e.relativePath)).toEqual(['a.json', 'b.json'])
    expect(planA.add.map(e => e.relativePath)).toEqual(planB.add.map(e => e.relativePath))
  })

  test('does not mutate its inputs', () => {
    const entries = [sourceEntry('b.json'), sourceEntry('a.json')]
    const orderSnapshot = entries.map(e => e.relativePath)
    const journalSnapshot = JSON.stringify(recordWith({ 'a.json': { sha256: SHA_A, sizeBytes: 10 } }))
    planMirrorDiff(entries, JSON.parse(journalSnapshot) as MirrorJournalRecord)

    expect(entries.map(e => e.relativePath)).toEqual(orderSnapshot)
    expect(JSON.stringify(recordWith({ 'a.json': { sha256: SHA_A, sizeBytes: 10 } }))).toBe(journalSnapshot)
    expect(Object.isFrozen(entries)).toBe(false)
  })

  test('returns cloned entries, not the input objects', () => {
    const entry = sourceEntry('a.json')
    const plan = planMirrorDiff([entry], recordWith({}))
    expect(plan.add[0]).not.toBe(entry)
    expect(plan.add[0]).toEqual(entry)
  })
})