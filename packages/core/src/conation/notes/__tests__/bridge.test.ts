import { describe, expect, it } from 'bun:test'
import { createNotesBridge } from '../bridge.ts'
import { CONATION_NOTES_BRIDGE_DEFAULT, CONATION_NOTES_BRIDGE_FLAG_ID } from '../flags.ts'
import type { NotesSoupClient } from '../types.ts'

function soupWith(
  items: Awaited<ReturnType<NotesSoupClient['queryUserSoupPage']>>['items'],
): NotesSoupClient {
  return {
    async queryUserSoupPage() {
      return { items, nextCursor: null }
    },
  }
}

const docs = [
  {
    id: 'n1',
    entityType: 'document',
    displayName: 'Alpha',
    __typename: 'GraphqlSoupDocument',
    properties: [{ name: 'body', value: 'hello' }],
  },
  {
    id: 'c1',
    entityType: 'chat',
    displayName: 'Not a note',
    __typename: 'GraphqlSoupChat',
  },
]

describe('notes flag', () => {
  it('is locked default false', () => {
    expect(CONATION_NOTES_BRIDGE_FLAG_ID).toBe('workbench.conation.notesBridge')
    expect(CONATION_NOTES_BRIDGE_DEFAULT).toBe(false)
  })
})

describe('createNotesBridge', () => {
  it('returns null when flag/enabled is false', () => {
    expect(
      createNotesBridge({
        enabled: false,
        soup: soupWith(docs),
        claimLocker: { canRead: () => 'allow' },
        importsAcl: { canView: () => true },
      }),
    ).toBeNull()
  })

  it('returns null when Soup client is missing', () => {
    expect(
      createNotesBridge({
        enabled: true,
        soup: null,
        claimLocker: { canRead: () => 'allow' },
        importsAcl: { canView: () => true },
      }),
    ).toBeNull()
  })

  it('fail-closes to empty list without claim locker', async () => {
    const bridge = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      importsAcl: { canView: () => true },
    })
    expect(bridge).not.toBeNull()
    const page = await bridge!.listNotes()
    expect(page.items).toEqual([])
  })

  it('filters out denied claims and non-documents', async () => {
    const bridge = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: (id) => (id === 'n1' ? 'allow' : 'deny') },
      importsAcl: { canView: () => true },
    })
    const page = await bridge!.listNotes()
    expect(page.items.map((d) => d.id)).toEqual(['n1'])
    expect(page.items[0]?.title).toBe('Alpha')
    expect(page.items[0]?.body).toBe('hello')
  })

  it('getNote returns null when claim denies', async () => {
    const bridge = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: () => 'deny' },
      importsAcl: { canView: () => true },
    })
    expect(await bridge!.getNote('n1')).toBeNull()
  })

  it('getNote returns document when claim and ACL allow', async () => {
    const bridge = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    const note = await bridge!.getNote('n1')
    expect(note?.id).toBe('n1')
    expect(note?.body).toBe('hello')
  })

  it('getNote finds a document past the first Soup page', async () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const soup: NotesSoupClient = {
      async queryUserSoupPage(args) {
        calls.push(args?.input)
        const cursor = typeof args?.input?.cursor === 'string' ? args.input.cursor : undefined
        if (!cursor) {
          return {
            items: [{ id: 'n1', entityType: 'document', displayName: 'First' }],
            nextCursor: 'page-2',
          }
        }
        return {
          items: [{ id: 'n2', entityType: 'document', displayName: 'Second' }],
          nextCursor: null,
        }
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    const note = await bridge!.getNote('n2')
    expect(note?.id).toBe('n2')
    expect(calls[0]).toMatchObject({ entityType: 'document' })
    expect(calls[1]).toMatchObject({ cursor: 'page-2' })
  })

  it('listNotes forwards cursor and limit', async () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const soup: NotesSoupClient = {
      async queryUserSoupPage(args) {
        calls.push(args?.input)
        return { items: docs, nextCursor: 'next' }
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    const page = await bridge!.listNotes({ cursor: 'c1', limit: 10 })
    expect(page.nextCursor).toBe('next')
    expect(calls[0]).toMatchObject({ cursor: 'c1', limit: 10, entityType: 'document' })
  })

  it('does not treat a Soup HTTP failure as an empty corpus', async () => {
    const soup: NotesSoupClient = {
      async queryUserSoupPage() {
        throw new Error('Soup GraphQL HTTP 503')
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    await expect(bridge!.listNotes()).rejects.toMatchObject({ code: 'NOTES_UNAVAILABLE' })
    await expect(bridge!.getNote('n1')).rejects.toMatchObject({ code: 'NOTES_UNAVAILABLE' })
  })

  it('stops getNote when the cursor does not advance', async () => {
    const soup: NotesSoupClient = {
      async queryUserSoupPage() {
        return {
          items: [{ id: 'n1', entityType: 'document', displayName: 'First' }],
          nextCursor: 'stuck',
        }
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    await expect(bridge!.getNote('missing')).rejects.toMatchObject({ code: 'NOTES_INCOMPLETE' })
  })

  it('exposes no write helpers', () => {
    const bridge = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    expect(bridge).not.toBeNull()
    expect('listNotes' in bridge! && 'getNote' in bridge!).toBe(true)
    expect('createNote' in bridge! || 'updateNote' in bridge! || 'deleteNote' in bridge!).toBe(
      false,
    )
  })
})
