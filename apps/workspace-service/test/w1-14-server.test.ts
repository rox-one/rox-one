/**
 * W1-14 (#1511) — Server-side reference handlers: presence fanout, collab
 * queries and drive upload admission.
 *
 * These are the halves of §11.1 / §11.7 / §16.2 that belong to the service:
 * co-membership, the DM privacy pair, and the S3 multipart calls. Each is
 * exercised through its port, so no bucket, gateway or database is needed.
 */

import { describe, expect, test } from 'bun:test'
import { TIB_BYTES } from '@rox/core/drive'
import { createPresenceFanout } from '../src/modules/presence/reference-handlers.ts'
import { createCollabQueries } from '../src/modules/collab/reference-handlers.ts'
import { createDriveUploadService } from '../src/modules/drive/reference-handlers.ts'
import { collabPresenceStore, resetCollabRuntime } from '@rox/server-core/collab'

const WS = 'ws-1'
const ANN = 'ann'
const BOB = 'bob'

describe('presence fanout (§11.1)', () => {
  test('a transition is published on the user topic of every co-member only', async () => {
    resetCollabRuntime()
    const published: Array<{ topic: string; payload: Record<string, unknown> }> = []
    const fanout = createPresenceFanout({
      sharesWith: async () => [ANN, BOB],
      publish: (topic, payload) => { published.push({ topic, payload }) },
    })
    const restore = fanout.configure()
    try {
      const store = collabPresenceStore()
      const result = await store.heartbeat(WS, ANN, { status: 'online', device: 'desktop' }, Date.parse('2026-10-08T12:00:00Z'))
      // The actor is never told about their own transition.
      expect(result.notify).toEqual([BOB])
      const topics = await fanout.publishHeartbeat(WS, ANN, result)
      expect(topics.sort()).toEqual([`user:${BOB}`])
      expect(published[0]!.payload).toMatchObject({ principalId: ANN, status: 'online' })
    } finally {
      restore()
      resetCollabRuntime()
    }
  })

  test('a receipt with nobody to tell publishes nothing', async () => {
    const fanout = createPresenceFanout({ sharesWith: async () => [], publish: () => { throw new Error('must not publish') } })
    expect(await fanout.publishHeartbeat(WS, ANN, { status: 'away', expiresAt: 0, notify: [] })).toEqual([])
  })
})

describe('collab queries (§11.7)', () => {
  const members = [
    { principalId: ANN, lastReadSeq: 5, readAt: '2026-10-08T12:00:00Z' },
    { principalId: BOB, lastReadSeq: 3 },
  ]

  test('"Read by" splits the members and keeps the privacy decision of a DM', async () => {
    const shared = createCollabQueries({
      chatMembers: async () => members,
      readReceiptPrivacy: async () => [{ principalId: ANN, shareReadReceipts: true }, { principalId: BOB, shareReadReceipts: true }],
      docViews: async () => [],
    })
    expect(await shared.readBy('c1', 4, 'dm')).toMatchObject({ shown: true, read: [ANN], unread: [BOB], emit: true })

    const hidden = createCollabQueries({
      chatMembers: async () => members,
      readReceiptPrivacy: async () => [{ principalId: ANN, shareReadReceipts: true }, { principalId: BOB, shareReadReceipts: false }],
      docViews: async () => [],
    })
    // Both sides off means neither sees the other's receipt.
    expect(await hidden.readBy('c1', 4, 'dm')).toMatchObject({ emit: false })
    expect(await hidden.readBy('c1', 4, 'group')).toMatchObject({ emit: true })
  })

  test('a group above the member cap reports no receipts at all', async () => {
    const queries = createCollabQueries({
      chatMembers: async () => Array.from({ length: 501 }, (_, index) => ({ principalId: `p${index}`, lastReadSeq: 1 })),
      readReceiptPrivacy: async () => [],
      docViews: async () => [],
    })
    expect(await queries.readBy('big', 1, 'group')).toMatchObject({ shown: false, read: [], emit: false })
  })

  test('"Viewed by" lists the doc views newest first', async () => {
    const queries = createCollabQueries({
      chatMembers: async () => [],
      readReceiptPrivacy: async () => [],
      docViews: async () => [
        { docId: 'd1', principalId: ANN, firstViewedAt: '2026-10-08T10:00:00Z', lastViewedAt: '2026-10-08T11:00:00Z', viewCount: 2 },
        { docId: 'd1', principalId: BOB, firstViewedAt: '2026-10-08T12:00:00Z', lastViewedAt: '2026-10-08T12:30:00Z', viewCount: 1 },
      ],
    })
    expect((await queries.viewers('d1')).map(viewer => viewer.principalId)).toEqual([BOB, ANN])
  })
})

describe('drive upload admission (§16.2)', () => {
  function port(quota: { quotaBytes: number; usedBytes: number; reservedBytes: number; state: 'active' | 'over_quota' | 'frozen' } | null) {
    const calls: string[] = []
    return {
      calls,
      storage: {
        quota: async () => quota,
        createMultipartUpload: async () => { calls.push('create'); return { s3UploadId: 's3-1' } },
        presignParts: async ({ partCount }: { s3UploadId: string; key: string; partCount: number }) => { calls.push(`presign:${partCount}`); return Array.from({ length: partCount }, (_, index) => `https://s3/part/${index + 1}`) },
        abortMultipartUpload: async () => { calls.push('abort') },
      },
    }
  }

  test('an admitted upload opens the multipart session and returns one URL per part', async () => {
    const fake = port({ quotaBytes: TIB_BYTES, usedBytes: 0, reservedBytes: 0, state: 'active' })
    const service = createDriveUploadService(fake.storage, () => new Date('2026-10-08T12:00:00Z'))
    const outcome = await service.openUpload({ driveId: 'd1', fileName: 'a.bin', sizeExpected: 5 })
    expect(outcome).toMatchObject({ s3UploadId: 's3-1', partUrls: ['https://s3/part/1'], parallelParts: 3 })
    expect(outcome).not.toHaveProperty('error')
    expect(fake.calls).toEqual(['create', 'presign:1'])
  })

  test('an upload past the quota is refused before S3 is touched', async () => {
    const fake = port({ quotaBytes: 1000, usedBytes: 900, reservedBytes: 0, state: 'active' })
    const service = createDriveUploadService(fake.storage)
    const outcome = await service.openUpload({ driveId: 'd1', fileName: 'a.bin', sizeExpected: 200 })
    expect(outcome).toMatchObject({ error: { code: 'QUOTA_EXCEEDED', detail: { used: 900, limit: 1000, needed: 200, free: 100 } } })
    expect(fake.calls).toEqual([])
  })

  test('a frozen drive and a missing drive row are both refused', async () => {
    const frozen = createDriveUploadService(port({ quotaBytes: 1000, usedBytes: 0, reservedBytes: 0, state: 'frozen' }).storage)
    expect(await frozen.openUpload({ driveId: 'd1', fileName: 'a.bin', sizeExpected: 1 })).toMatchObject({ error: { code: 'QUOTA_EXCEEDED' } })
    const missing = createDriveUploadService(port(null).storage)
    expect(await missing.openUpload({ driveId: 'd1', fileName: 'a.bin', sizeExpected: 1 })).toMatchObject({ error: { code: 'QUOTA_EXCEEDED', detail: { limit: 0 } } })
  })

  test('abort releases the multipart upload with its key', async () => {
    const fake = port({ quotaBytes: TIB_BYTES, usedBytes: 0, reservedBytes: 0, state: 'active' })
    const service = createDriveUploadService(fake.storage)
    const outcome = await service.openUpload({ driveId: 'd1', fileName: 'a.bin', sizeExpected: 5 })
    if ('error' in outcome) throw new Error('expected an upload session')
    await service.abortUpload({ s3UploadId: outcome.s3UploadId, key: outcome.key })
    expect(fake.calls.at(-1)).toBe('abort')
  })
})