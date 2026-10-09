/**
 * W1-14 (#1511) — Drive reference handler tests (TECH-SPEC §16, D-v2-8).
 *
 * The quota-bearing protocol end to end on the memory backend: provision,
 * reservation, completion, ledger, versions and the negative paths the plan
 * requires (past quota, expired session, a foreign session).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { TIB_BYTES } from '@rox/core/drive'
import { InMemoryCommandStore } from '../../commands/store'
import { configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../../work/reference'
import { createHarness } from '../../work/__tests__/reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from '../../work/__tests__/reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const ALLOW_ALL: Authorizer = { can: async () => true }
const SHA = 'ab'.repeat(32)

let clock = NOW
function memoryHarness(options: { authorizer?: Authorizer } = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), authorizer: options.authorizer ?? ALLOW_ALL })
}

beforeEach(() => {
  clock = NOW
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => clock })
})
afterEach(() => resetReferenceRuntime())

const records = (collection: string) => referenceMemoryRecords(WORKSPACE_ID, collection)
const driveRow = () => records('drive-quota').find(row => row.id === ACTOR_ID)

describe('drive.provision (R5)', () => {
  test('a drive row plus the «Мой диск» root folder, 1 TiB by default', async () => {
    const harness = memoryHarness()
    const receipt = await harness.run({ type: 'drive.provision', payload: {} })
    expect(receipt).toMatchObject({ status: 'applied', result: { quotaBytes: TIB_BYTES, existed: false } })
    expect(driveRow()!.data).toMatchObject({ ownerPrincipalId: ACTOR_ID, quotaBytes: TIB_BYTES, usedBytes: 0, reservedBytes: 0, trashBytes: 0, state: 'active' })
    const folder = records('folder')[0]!
    expect(folder.data).toMatchObject({ name: 'Мой диск', ownerType: 'user', ownerId: ACTOR_ID })
  })

  test('provisioning twice keeps the same drive and root folder', async () => {
    const harness = memoryHarness()
    const first = await harness.run({ type: 'drive.provision', payload: { quotaBytes: 1000 } })
    const again = await harness.run({ type: 'drive.provision', payload: { quotaBytes: 1000 } })
    expect(again).toMatchObject({ status: 'applied', result: { existed: true, quotaBytes: 1000 } })
    expect(records('drive-quota')).toHaveLength(1)
    expect(records('folder')).toHaveLength(1)
    expect((again.result as { rootFolderRef: unknown }).rootFolderRef).toEqual((first.result as { rootFolderRef: unknown }).rootFolderRef)
  })

  test('drive.provision with a non-positive quota is rejected as VALIDATION', async () => {
    const harness = memoryHarness()
    const receipt = await harness.run({ type: 'drive.provision', payload: { quotaBytes: -1 } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })
})

describe('the upload protocol (§16.2)', () => {
  async function provisioned(quotaBytes: number) {
    const harness = memoryHarness()
    await harness.run({ type: 'drive.provision', payload: { quotaBytes } })
    return harness
  }

  test('drive.open_upload reserves the size and plans the parts', async () => {
    const harness = await provisioned(TIB_BYTES)
    const receipt = await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 5 } })
    expect(receipt).toMatchObject({ status: 'applied', result: { uploadSessionId: U('upload'), partCount: 1, partSizeBytes: 5, instant: false } })
    expect(driveRow()!.data).toMatchObject({ usedBytes: 0, reservedBytes: 5 })
    expect(records('upload-session')[0]!.data).toMatchObject({ status: 'open', reservedBytes: 5, fileName: 'a.bin' })
  })

  test('drive.open_upload past the quota is rejected with QUOTA_EXCEEDED {used, limit, needed, free}', async () => {
    const harness = await provisioned(1000)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('first'), fileName: 'a.bin', sizeExpected: 600 } })
    const receipt = await harness.run({ type: 'drive.open_upload', payload: { id: U('second'), fileName: 'b.bin', sizeExpected: 500 } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'QUOTA_EXCEEDED', details: { used: 0, limit: 1000, needed: 500, free: 400 } } })
    // The reservation of the first upload is untouched by the rejection.
    expect(driveRow()!.data.reservedBytes).toBe(600)
    expect(records('upload-session')).toHaveLength(1)
  })

  test('drive.open_upload without a drive is NOT_FOUND', async () => {
    const harness = memoryHarness()
    const receipt = await harness.run({ type: 'drive.open_upload', payload: { fileName: 'a.bin', sizeExpected: 1 } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
  })

  test('drive.open_upload on a known sha256 is instant and still charges the ledger', async () => {
    const harness = await provisioned(1000)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] } })
    const again = await harness.run({ type: 'drive.open_upload', payload: { id: U('upload-2'), fileName: 'a-again.bin', sizeExpected: 10, sha256: SHA } })
    expect(again).toMatchObject({ status: 'applied', result: { instant: true, partCount: 0 } })
    await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload-2'), sha256: SHA } })
    // Twice uploaded, twice charged: dedupe saves backend space, never the charge.
    expect(driveRow()!.data.usedBytes).toBe(20)
    expect(records('storage-ledger').filter(entry => entry.data.reason === 'upload')).toHaveLength(2)
  })

  test('drive.complete_upload creates the file, its version, the ledger entry and queues the preview', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] } })
    expect(receipt).toMatchObject({ status: 'applied', result: { versionNo: 1, sizeBytes: 10, usedBytes: 10, reservedBytes: 0, previewQueued: true } })
    expect(driveRow()!.data).toMatchObject({ usedBytes: 10, reservedBytes: 0 })
    const file = records('file')[0]!
    expect(file.data).toMatchObject({ name: 'a.bin', sizeBytes: 10, sha256: SHA, currentVersion: 1, ownerDriveId: ACTOR_ID })
    expect(records('file-version')[0]!.data).toMatchObject({ versionNo: 1, sizeBytes: 10, sha256: SHA })
    expect(records('storage-ledger')[0]!.data).toMatchObject({ reason: 'upload', deltaBytes: 10 })
    expect(records('file-preview').length).toBeGreaterThan(0)
    expect(records('file-blob')[0]!.id).toBe(SHA)
  })

  test('drive.complete_upload whose parts do not add up is rejected and charges nothing', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 1024 } })
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 1 }] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(records('file')).toEqual([])
    expect(records('storage-ledger')).toEqual([])
    expect(driveRow()!.data).toMatchObject({ usedBytes: 0, reservedBytes: 1024 })
    expect(records('upload-session')[0]!.data.status).toBe('open')
  })

  test('drive.complete_upload without attesting part sizes is an explicit unverified upload', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10 } })
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1' }] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION', message: 'unverified upload: every part must report its size' } })
    expect(records('storage-ledger')).toEqual([])
    expect(records('file')).toEqual([])
  })

  test('drive.complete_upload on an expired session is rejected as expired and writes no file', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10 } })
    clock = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1)
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION', message: 'upload session expired' } })
    expect(records('file')).toEqual([])
    expect(driveRow()!.data.usedBytes).toBe(0)
  })

  test('drive.complete_upload with a sha256 that contradicts the declaration is rejected', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: 'cd'.repeat(32) } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test("drive.complete_upload on someone else's session is FORBIDDEN", async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10 } })
    const receipt = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] }, actor: BOB })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test('drive.abort_upload hands the reservation back', async () => {
    const harness = await provisioned(1000)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 400 } })
    expect(driveRow()!.data.reservedBytes).toBe(400)
    const receipt = await harness.run({ type: 'drive.abort_upload', payload: { uploadSessionId: U('upload') } })
    expect(receipt).toMatchObject({ status: 'applied', result: { releasedBytes: 400 } })
    expect(driveRow()!.data.reservedBytes).toBe(0)
    // The freed space is usable again.
    expect(await harness.run({ type: 'drive.open_upload', payload: { id: U('big'), fileName: 'b.bin', sizeExpected: 1000 } })).toMatchObject({ status: 'applied' })
  })

  test('drive.abort_upload on a session that already finished is rejected', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('upload'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('upload'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] } })
    const receipt = await harness.run({ type: 'drive.abort_upload', payload: { uploadSessionId: U('upload') } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(driveRow()!.data.usedBytes).toBe(10)
  })

  test('an open upload past its deadline releases its reservation before the next admission', async () => {
    const harness = await provisioned(1000)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('stale'), fileName: 'a.bin', sizeExpected: 900 } })
    clock = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1)
    const receipt = await harness.run({ type: 'drive.open_upload', payload: { id: U('next'), fileName: 'b.bin', sizeExpected: 900 } })
    expect(receipt).toMatchObject({ status: 'applied' })
    expect(records('upload-session').find(row => row.id === U('stale'))!.data.status).toBe('expired')
    expect(driveRow()!.data.reservedBytes).toBe(900)
  })

  test('a version of an existing file adds a version and charges again', async () => {
    const harness = await provisioned(TIB_BYTES)
    await harness.run({ type: 'drive.open_upload', payload: { id: U('u1'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('u1'), sha256: SHA, parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }] } })
    await harness.run({ type: 'drive.open_upload', payload: { id: U('u2'), fileName: 'a.bin', sizeExpected: 10, sha256: SHA } })
    const second = await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('u2'), sha256: SHA } })
    expect(second).toMatchObject({ result: { versionNo: 2 } })
    expect(records('file')).toHaveLength(1)
    expect(records('file-version')).toHaveLength(2)
    expect(driveRow()!.data.usedBytes).toBe(20)
  })
})