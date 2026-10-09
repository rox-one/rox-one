import { describe, test, expect } from 'bun:test'
import {
  DRIVE_DEFAULT_QUOTA_BYTES,
  DRIVE_MAX_PARALLEL_PARTS,
  DRIVE_PART_SIZE_BYTES,
  aggregateProgress,
  maxParallelism,
  meterFraction,
  meterLevel,
  parallelBatches,
  planParts,
  recomputeLedger,
  remainingBytes,
  type DriveUploadSession,
} from '../index'

const MiB = 1024 * 1024

describe('planParts', () => {
  test('splits a file into ordered 16 MiB parts', () => {
    const parts = planParts(40 * MiB)
    expect(parts).toHaveLength(3)
    expect(parts.map(p => p.sizeBytes)).toEqual([16 * MiB, 16 * MiB, 8 * MiB])
    expect(parts.map(p => [p.start, p.end])).toEqual([[0, 16 * MiB], [16 * MiB, 32 * MiB], [32 * MiB, 40 * MiB]])
  })

  test('a zero-byte file still has exactly one verifiable part', () => {
    const parts = planParts(0)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ index: 0, start: 0, end: 0, sizeBytes: 0 })
  })

  test('a part covers the exact tail', () => {
    const parts = planParts(DRIVE_PART_SIZE_BYTES + 1)
    expect(parts).toHaveLength(2)
    expect(parts[1]?.sizeBytes).toBe(1)
  })

  test('rejects negative and non-finite sizes', () => {
    expect(() => planParts(-1)).toThrow()
    expect(() => planParts(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('parallel batch bounds (8 parts in flight)', () => {
  test('never schedules more than the concurrency bound', () => {
    for (const count of [0, 1, 7, 8, 9, 16, 17, 100]) {
      expect(maxParallelism(count)).toBeLessThanOrEqual(DRIVE_MAX_PARALLEL_PARTS)
      expect(maxParallelism(count)).toBe(Math.min(count, DRIVE_MAX_PARALLEL_PARTS))
    }
  })

  test('every part index appears exactly once across batches', () => {
    const batches = parallelBatches(21, DRIVE_MAX_PARALLEL_PARTS)
    const flattened = batches.flat().sort((a, b) => a - b)
    expect(flattened).toEqual(Array.from({ length: 21 }, (_, i) => i))
    expect(batches[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(batches.at(-1)).toEqual([16, 17, 18, 19, 20])
  })

  test('default concurrency is 8', () => {
    expect(DRIVE_MAX_PARALLEL_PARTS).toBe(8)
    expect(parallelBatches(8)[0]).toHaveLength(8)
  })
})

describe('meter thresholds (amber ≥80%, red ≥95%)', () => {
  test('ok below 80%', () => {
    expect(meterLevel(0, 100)).toBe('ok')
    expect(meterLevel(79, 100)).toBe('ok')
  })

  test('amber from 80% up to 95%', () => {
    expect(meterLevel(80, 100)).toBe('warn')
    expect(meterLevel(94, 100)).toBe('warn')
  })

  test('red from 95%', () => {
    expect(meterLevel(95, 100)).toBe('critical')
    expect(meterLevel(100, 100)).toBe('critical')
  })

  test('1 TiB default quota: 80% and 95% boundaries', () => {
    expect(meterLevel(DRIVE_DEFAULT_QUOTA_BYTES * 0.8, DRIVE_DEFAULT_QUOTA_BYTES)).toBe('warn')
    expect(meterLevel(DRIVE_DEFAULT_QUOTA_BYTES * 0.95, DRIVE_DEFAULT_QUOTA_BYTES)).toBe('critical')
  })

  test('fraction clamps to [0,1] and degrades safely with no quota', () => {
    expect(meterFraction(50, 100)).toBe(0.5)
    expect(meterFraction(200, 100)).toBe(1)
    expect(meterFraction(10, 0)).toBe(0)
  })
})

describe('ledger recompute', () => {
  test('sums completed file sizes and reserves open parts', () => {
    const quota = recomputeLedger([100, 200, 0, -5], DRIVE_DEFAULT_QUOTA_BYTES, 50)
    expect(quota).toEqual({
      totalBytes: DRIVE_DEFAULT_QUOTA_BYTES,
      usedBytes: 300,
      reservedBytes: 50,
      freeBytes: DRIVE_DEFAULT_QUOTA_BYTES - 350,
    })
  })

  test('freeBytes never goes negative', () => {
    expect(recomputeLedger([200], 100, 0).freeBytes).toBe(0)
  })
})

describe('progress aggregation', () => {
  const session = (overrides: Partial<DriveUploadSession> = {}): DriveUploadSession => ({
    id: 'u1', workspaceId: 'w1', name: 'a.bin', size: 32 * MiB, folderId: 'root',
    partSize: DRIVE_PART_SIZE_BYTES, source: 'upload', status: 'open',
    parts: [
      { index: 0, sizeBytes: 16 * MiB, done: true },
      { index: 1, sizeBytes: 16 * MiB, done: false },
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })

  test('remainingBytes counts only undone parts', () => {
    expect(remainingBytes(session().parts)).toBe(16 * MiB)
  })

  test('aggregate merges open and completed sessions', () => {
    const result = aggregateProgress([
      session(),
      session({ id: 'u2', status: 'completed', parts: [
        { index: 0, sizeBytes: 16 * MiB, done: true },
        { index: 1, sizeBytes: 16 * MiB, done: true },
      ] }),
      session({ id: 'u3', status: 'aborted' }),
    ])
    expect(result.totalFiles).toBe(3)
    expect(result.doneFiles).toBe(1)
    expect(result.doneBytes).toBe(16 * MiB + 32 * MiB)
  })
})