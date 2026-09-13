import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../../types.ts'
import { createFileStore, listFiles, moveFile, uploadFile, type FileRecord } from '../files.ts'

function file(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'file-1',
    path: '/docs/a.txt',
    contentSha256: 'sha256:aaa',
    accountId: 'acct-1',
    revision: '1',
    signed: true,
    ...overrides,
  }
}

describe('conation files (#379) fail-closed', () => {
  it('lists a file that lives on page 2', () => {
    const store = createFileStore([
      file({ id: 'f1', path: '/a' }),
      file({ id: 'f2', path: '/b' }),
    ])
    expect(listFiles(store, 1, 1)[0]?.id).toBe('f2')
  })

  it('does not claim live DSS upload or move', () => {
    const store = createFileStore()
    const uploaded = uploadFile(store, file(), {})
    expect(uploaded.status).toBe('blocked')
    expect(uploaded.reason).toBe('dss-conation-unconfirmed')
    expect(uploaded.live).toBe(false)
    expect(uploaded.evidenceLevel).toBe('U1')
    expect(uploaded.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(uploaded)).toBe(false)
    expect(store.byId.size).toBe(0)
    expect(store.files.size).toBe(0)

    const existing = createFileStore([file()])
    const moved = moveFile(existing, 'file-1', '/docs/b.txt')
    expect(moved.status).toBe('blocked')
    expect(moved.reason).toBe('dss-conation-unconfirmed')
    expect(moved.live).toBe(false)
    expect(moved.evidenceLevel).toBe('U1')
    expect(moved.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(moved)).toBe(false)
    expect(existing.byId.get('file-1')?.path).toBe('/docs/a.txt')
    expect(existing.files.has('/docs/b.txt')).toBe(false)
  })

  it('would still deny unsigned / corrupt / timeout writes if live opened', () => {
    const store = createFileStore()
    expect(uploadFile(store, file({ signed: false }), {}).status).toBe('blocked')
    expect(uploadFile(store, file(), { corrupt: true }).status).toBe('blocked')
    expect(uploadFile(store, file(), { timeout: true }).status).toBe('blocked')
    expect(store.byId.has('file-1')).toBe(false)
  })

  it('keeps id identity independent of path when move stays blocked', () => {
    const store = createFileStore([file({ id: 'file-1', path: '/docs/a.txt' })])
    expect(listFiles(store, 0, 1)[0]?.id).toBe('file-1')
    expect(listFiles(store, 0, 1)[0]?.path).toBe('/docs/a.txt')
    expect(moveFile(store, 'file-1', '/docs/b.txt').status).toBe('blocked')
    expect(store.byId.get('file-1')?.id).toBe('file-1')
    expect(store.byId.get('file-1')?.path).toBe('/docs/a.txt')
    expect(store.byId.get('file-1')?.contentSha256).toBe('sha256:aaa')
    expect(store.byId.get('file-1')?.accountId).toBe('acct-1')
  })
})
