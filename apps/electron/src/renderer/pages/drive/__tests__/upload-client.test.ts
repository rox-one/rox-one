import { describe, test, expect } from 'bun:test'
import { DRIVE_MAX_PARALLEL_PARTS, DRIVE_PART_SIZE_BYTES, planParts, type DriveFile, type DriveUploadSession } from '@rox/shared/drive'
import { isRetryableUploadError, runRendererUpload, type DriveUploadApi } from '../upload-client'

const MiB = 1024 * 1024

interface Harness {
  api: DriveUploadApi
  uploaded: number[]
  stats: { maxConcurrency: number }
}

function buildHarness(options: { doneParts?: number[] } = {}): Harness {
  const uploaded: number[] = []
  const stats = { maxConcurrency: 0 }
  let inFlight = 0
  const doneSet = new Set(options.doneParts ?? [])

  const api: DriveUploadApi = {
    async driveOpenUpload(_workspaceId, input): Promise<DriveUploadSession> {
      const plan = planParts(input.size)
      return {
        id: 'u1', workspaceId: 'ws1', name: input.name, size: input.size, folderId: 'root',
        partSize: DRIVE_PART_SIZE_BYTES, source: input.source ?? 'upload', status: 'open',
        parts: plan.map(part => ({ index: part.index, sizeBytes: part.sizeBytes, done: doneSet.has(part.index) })),
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }
    },
    async driveUploadPart(_workspaceId, _uploadId, index) {
      // A microtask yield lets the whole batch enter before any of them finish,
      // so the observed in-flight count reflects the scheduler's batch size —
      // no wall-clock timer involved.
      inFlight += 1
      stats.maxConcurrency = Math.max(stats.maxConcurrency, inFlight)
      await Promise.resolve()
      uploaded.push(index)
      inFlight -= 1
      return { index, done: true }
    },
    async driveCompleteUpload(): Promise<DriveFile> {
      return { id: 'u1', name: 'file', size: 0, folderId: 'root', prefix: 'u1', sha256: 'a'.repeat(64), source: 'upload', createdAt: '2026-01-01T00:00:00.000Z' }
    },
    async driveAbortUpload() {},
  }
  return { api, uploaded, stats }
}

describe('runRendererUpload', () => {
  test('uploads every part and never exceeds 8 in flight', async () => {
    const bytes = new Uint8Array(200 * MiB)
    const file = new File([bytes], 'big.bin')
    const harness = buildHarness()
    const progress: Array<{ doneParts: number }> = []

    const result = await runRendererUpload(harness.api, {
      workspaceId: 'ws1', file, name: 'big.bin', size: file.size, source: 'upload',
      onProgress: p => progress.push({ doneParts: p.doneParts }),
    })

    const expectedParts = planParts(file.size).length
    expect(expectedParts).toBe(13)
    expect(harness.uploaded).toHaveLength(expectedParts)
    expect(harness.uploaded.sort((a, b) => a - b)).toEqual(Array.from({ length: expectedParts }, (_, i) => i))
    expect(harness.stats.maxConcurrency).toBe(DRIVE_MAX_PARALLEL_PARTS)
    expect(harness.stats.maxConcurrency).toBeLessThanOrEqual(DRIVE_MAX_PARALLEL_PARTS)
    expect(progress.at(-1)?.doneParts).toBe(expectedParts)
    expect(result.resumed).toBe(false)
  })

  test('resumes: only undone parts are re-uploaded', async () => {
    const bytes = new Uint8Array(50 * MiB) // 4 parts
    const file = new File([bytes], 'resume.bin')
    const harness = buildHarness({ doneParts: [0, 1] })

    const result = await runRendererUpload(harness.api, {
      workspaceId: 'ws1', file, name: 'resume.bin', size: file.size, source: 'upload',
    })

    expect(harness.uploaded.sort((a, b) => a - b)).toEqual([2, 3])
    expect(result.resumed).toBe(true)
  })

  test('device-backup parts send no bytes to uploadPart', async () => {
    const seen: Array<Uint8Array | undefined> = []
    const api = buildHarness().api
    const wrapped: DriveUploadApi = {
      ...api,
      async driveUploadPart(workspaceId, uploadId, index, bytes) {
        seen.push(bytes)
        return api.driveUploadPart(workspaceId, uploadId, index, bytes)
      },
    }
    await runRendererUpload(wrapped, {
      workspaceId: 'ws1', name: 'backup.bin', size: 16 * MiB, source: 'device-backup',
      sourceKind: 'downloads', relativePath: 'a.bin',
    })
    expect(seen).toEqual([undefined])
  })
})

describe('isRetryableUploadError', () => {
  test('marks transient codes retryable', () => {
    expect(isRetryableUploadError({ code: 'DRIVE_PARTS_INCOMPLETE' })).toBe(true)
    expect(isRetryableUploadError({ code: 'DRIVE_CHECKSUM_MISMATCH' })).toBe(true)
    expect(isRetryableUploadError({ code: 'INVALID_PAYLOAD' })).toBe(false)
    expect(isRetryableUploadError(null)).toBe(false)
  })
})