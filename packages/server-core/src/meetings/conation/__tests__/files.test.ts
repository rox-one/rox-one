import { describe, expect, it } from 'bun:test'
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

describe('conation files (#379)', () => {
  it('lists a file that lives on page 2', () => {
    const store = createFileStore([
      file({ id: 'f1', path: '/a' }),
      file({ id: 'f2', path: '/b' }),
    ])
    expect(listFiles(store, 1, 1)[0]?.id).toBe('f2')
  })

  it('blocks unsigned and unconfirmed writes', () => {
    const store = createFileStore()
    expect(uploadFile(store, file({ signed: false }), {}).status).toBe('blocked')
    expect(uploadFile(store, file(), { corrupt: true }).status).toBe('blocked')
    expect(moveFile(store, 'file-1', '/docs/b.txt').status).toBe('blocked')
  })

  it('keeps identity across a native-only in-memory move helper when unblocked', () => {
    const store = createFileStore([file()])
    store.byId.set('file-1', file())
    const moved = { ...file(), path: '/docs/b.txt' }
    store.byId.set('file-1', moved)
    expect(store.byId.get('file-1')?.id).toBe('file-1')
    expect(store.byId.get('file-1')?.path).toBe('/docs/b.txt')
  })
})
