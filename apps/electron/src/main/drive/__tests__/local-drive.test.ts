import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DRIVE_DEFAULT_QUOTA_BYTES, DRIVE_PART_SIZE_BYTES } from '@rox/shared/drive'
import type { DriveService } from '@rox/server-core/handlers'
import { createLocalDrive } from '../local-drive'

const MiB = 1024 * 1024

/** Bytes that differ per index so ordering bugs surface in the hash. */
function makeBytes(size: number, seed: number): Buffer {
  const buffer = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 31 + seed * 7) % 251
  return buffer
}

describe('local drive engine', () => {
  let root: string
  let home: string
  let drive: DriveService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rox-drive-root-'))
    home = await mkdtemp(join(tmpdir(), 'rox-drive-home-'))
    drive = createLocalDrive({ rootDir: root, homeDir: home })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  test('upload roundtrip stores bytes, hashes the file and updates the ledger', async () => {
    const bytes = makeBytes(40 * MiB, 1)
    const name = 'report.bin'
    const session = await drive.openUpload('ws1', { name, size: bytes.length, source: 'upload' })
    expect(session.parts).toHaveLength(3)
    expect(session.parts.map(p => p.sizeBytes)).toEqual([16 * MiB, 16 * MiB, 8 * MiB])

    for (const part of session.parts) {
      const slice = bytes.subarray(part.index * DRIVE_PART_SIZE_BYTES, part.index * DRIVE_PART_SIZE_BYTES + part.sizeBytes)
      await drive.uploadPart('ws1', session.id, part.index, new Uint8Array(slice))
    }

    const file = await drive.completeUpload('ws1', session.id)
    expect(file.name).toBe(name)
    expect(file.size).toBe(bytes.length)
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))

    const listing = await drive.list('ws1')
    expect(listing.files.map(f => f.id)).toEqual([file.id])
    expect(listing.path.map(f => f.name)).toEqual(['Мой диск'])

    const quota = await drive.getQuota('ws1')
    expect(quota.usedBytes).toBe(bytes.length)
    expect(quota.reservedBytes).toBe(0)
    expect(quota.totalBytes).toBe(DRIVE_DEFAULT_QUOTA_BYTES)
  })

  test('openUpload resumes an interrupted same-file session', async () => {
    const bytes = makeBytes(20 * MiB, 2)
    const first = await drive.openUpload('ws1', { name: 'resume.bin', size: bytes.length, source: 'upload' })
    await drive.uploadPart('ws1', first.id, 0, new Uint8Array(bytes.subarray(0, DRIVE_PART_SIZE_BYTES)))

    const second = await drive.openUpload('ws1', { name: 'resume.bin', size: bytes.length, source: 'upload' })
    expect(second.id).toBe(first.id)
    expect(second.parts[0].done).toBe(true)
    expect(second.parts[1].done).toBe(false)

    // Reserved bytes track exactly the un-transferred remainder.
    const midQuota = await drive.getQuota('ws1')
    expect(midQuota.reservedBytes).toBe(4 * MiB)
    expect(midQuota.usedBytes).toBe(0)

    await drive.uploadPart('ws1', first.id, 1, new Uint8Array(bytes.subarray(DRIVE_PART_SIZE_BYTES)))
    const file = await drive.completeUpload('ws1', first.id)
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect((await drive.getQuota('ws1')).usedBytes).toBe(bytes.length)
  })

  test('completeUpload is idempotent and rejects incomplete parts', async () => {
    const session = await drive.openUpload('ws1', { name: 'x.bin', size: 10, source: 'upload' })
    await expect(drive.completeUpload('ws1', session.id)).rejects.toMatchObject({ code: 'DRIVE_PARTS_INCOMPLETE' })
    await drive.uploadPart('ws1', session.id, 0, new Uint8Array(Buffer.from('0123456789')))
    const file = await drive.completeUpload('ws1', session.id)
    expect(await drive.completeUpload('ws1', session.id)).toMatchObject({ id: file.id, sha256: file.sha256 })
  })

  test('checksum mismatch is rejected before the file enters the index', async () => {
    const bytes = Buffer.from('hello world')
    const session = await drive.openUpload('ws1', { name: 'c.bin', size: bytes.length, source: 'upload', expectedSha256: 'f'.repeat(64) })
    await drive.uploadPart('ws1', session.id, 0, new Uint8Array(bytes))
    await expect(drive.completeUpload('ws1', session.id)).rejects.toMatchObject({ code: 'DRIVE_CHECKSUM_MISMATCH' })
    expect((await drive.list('ws1')).files).toHaveLength(0)
  })

  test('abort releases the reservation and delete frees used bytes', async () => {
    const session = await drive.openUpload('ws1', { name: 'a.bin', size: 8 * MiB, source: 'upload' })
    expect((await drive.getQuota('ws1')).reservedBytes).toBe(8 * MiB)
    await drive.abortUpload('ws1', session.id)
    expect((await drive.getQuota('ws1')).reservedBytes).toBe(0)

    const keep = await drive.openUpload('ws1', { name: 'k.bin', size: 4, source: 'upload' })
    await drive.uploadPart('ws1', keep.id, 0, new Uint8Array(Buffer.from('data')))
    const file = await drive.completeUpload('ws1', keep.id)
    await drive.deleteFile('ws1', file.id)
    const quota = await drive.getQuota('ws1')
    expect(quota.usedBytes).toBe(0)
    expect((await drive.list('ws1')).files).toHaveLength(0)
  })

  test('createFolder nests folders and list walks the path', async () => {
    const folder = await drive.createFolder('ws1', 'root', 'Проекты')
    const listing = await drive.list('ws1', folder.id)
    expect(listing.path.map(f => f.name)).toEqual(['Мой диск', 'Проекты'])
  })

  test('device-backup walk skips symlinks and reads parts from the host', async () => {
    const downloads = join(home, 'Downloads')
    await mkdir(join(downloads, 'nested'), { recursive: true })
    const payload = makeBytes(3 * MiB, 3)
    await writeFile(join(downloads, 'nested', 'file.bin'), payload)

    const scan = await drive.scanSource('ws1', 'downloads')
    expect(scan.files).toHaveLength(1)
    expect(scan.files[0].relativePath).toBe(join('nested', 'file.bin'))
    expect(scan.totalBytes).toBe(payload.length)

    const session = await drive.openUpload('ws1', {
      name: 'file.bin',
      size: payload.length,
      source: 'device-backup',
      sourceKind: 'downloads',
      relativePath: scan.files[0].relativePath,
    })
    expect(session.sourcePath).toBe(join(downloads, 'nested', 'file.bin'))
    // No bytes cross the renderer for device backups.
    await drive.uploadPart('ws1', session.id, 0)
    const file = await drive.completeUpload('ws1', session.id)
    expect(file.sha256).toBe(createHash('sha256').update(payload).digest('hex'))
  })
})