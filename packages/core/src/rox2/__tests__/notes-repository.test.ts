import { describe, expect, test } from 'bun:test'
import { Rox2NoteRepository, noteOriginIsConation } from '../notes-repository.ts'

describe('Rox2NoteRepository (issue 324)', () => {
  test('local notes are never claimed as Conation', () => {
    const repo = new Rox2NoteRepository()
    const note = repo.createLocal({
      ref: { workspaceId: 'ws', entityId: 'n1', revisionId: '1' },
      title: 'Local',
      body: 'body',
    })
    expect(note.origin).toBe('local')
    expect(note.syncState).toBe('local-only')
    expect(noteOriginIsConation(note)).toBe(false)
    expect(repo.get(note.ref)?.origin).toBe('local')
  })

  test('rename keeps EntityId and CAS rejects a stale revision (issue 371)', () => {
    const repo = new Rox2NoteRepository()
    const created = repo.createLocal({
      ref: { workspaceId: 'ws', entityId: 'stable', revisionId: '1' },
      title: 'Old',
      body: 'one',
      properties: { decisionKey: 'k1' },
    })
    const renamed = repo.rename(created.ref, 'New', created.ref.revisionId)
    expect(renamed.ref.entityId).toBe('stable')
    expect(repo.getByEntityId('ws', 'stable')?.title).toBe('New')
    expect(() => repo.update(created.ref, { body: 'two' }, created.ref.revisionId)).toThrow()
    expect(repo.getByEntityId('ws', 'stable')?.body).toBe('one')
  })

  test('remote notes without a live adapter stay cached/offline/denied', () => {
    const repo = new Rox2NoteRepository()
    const binding = { provider: 'conation', account: 'a', remoteType: 'document', remoteId: 'soup-1' }
    const cached = repo.cacheRemote({
      ref: { workspaceId: 'ws', entityId: 'n2', revisionId: '3' },
      title: 'Remote',
      body: 'cached body',
      binding,
      syncState: 'cached',
    })
    expect(cached.origin).toBe('conation')
    expect(cached.syncState).toBe('cached')
    expect(repo.cacheRemote({
      ref: { workspaceId: 'ws', entityId: 'n3', revisionId: '1' },
      title: 'Denied',
      body: '',
      binding: { ...binding, remoteId: 'soup-2' },
      syncState: 'denied',
    }).syncState).toBe('denied')
  })
})
