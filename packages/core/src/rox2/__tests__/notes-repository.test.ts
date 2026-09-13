import { describe, expect, test } from 'bun:test'
import { createNotesRepository, nativeNoteRecord } from '../notes-repository.ts'

describe('ROX2 notes repository', () => {
  test('local notes never report a Conation origin', () => {
    const repo = createNotesRepository([
      nativeNoteRecord({ id: 'daily', title: 'Daily', body: 'hi', revision: 'r1', updatedAt: 1 }),
    ])
    const local = repo.get('note:daily')
    expect(local.status).toBe('ok')
    if (local.status === 'ok') {
      expect(local.note.origin).toBe('native')
      expect(local.sync).toBe('live')
    }
  })

  test('offline conation rows are cached stale; denied stays denied', () => {
    const repo = createNotesRepository()
    repo.put({
      entityId: 'note:remote',
      title: 'Remote',
      body: 'ext',
      origin: 'conation',
      revision: 'rev-9',
      updatedAt: 2,
    })
    const offline = repo.get('note:remote', { online: false })
    expect(offline.status).toBe('ok')
    if (offline.status === 'ok') {
      expect(offline.note.origin).toBe('conation')
      expect(offline.sync).toBe('stale')
    }
    expect(repo.get('note:remote', { readable: false }).status).toBe('denied')
    expect(repo.get('note:missing').status).toBe('not_found')
  })
})
