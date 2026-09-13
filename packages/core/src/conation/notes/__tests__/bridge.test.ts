import { describe, expect, it } from 'bun:test'
import { createNotesBridge } from '../bridge.ts'
import { CONATION_NOTES_BRIDGE_DEFAULT, CONATION_NOTES_BRIDGE_FLAG_ID } from '../flags.ts'
import type { NotesSoupClient } from '../types.ts'

function soupWith(
  items: Awaited<ReturnType<NotesSoupClient['queryUserSoupPage']>>['items'],
  nextCursor: string | null = null,
): NotesSoupClient {
  return {
    async queryUserSoupPage() {
      return { items, nextCursor }
    },
  }
}

function soupPages(
  pages: Array<{
    cursor: string | null
    items: Awaited<ReturnType<NotesSoupClient['queryUserSoupPage']>>['items']
    nextCursor: string | null
  }>,
): NotesSoupClient {
  return {
    async queryUserSoupPage(args) {
      const cursor = typeof args?.input?.cursor === 'string' ? args.input.cursor : null
      const page = pages.find((item) => item.cursor === cursor) ?? pages[0]
      if (!page) throw new Error('missing soup page')
      return { items: page.items, nextCursor: page.nextCursor }
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
    const page1 = [
      {
        id: 'n1',
        entityType: 'document',
        displayName: 'Alpha',
        __typename: 'GraphqlSoupDocument',
      },
    ]
    const page2 = [
      {
        id: 'n2',
        entityType: 'document',
        displayName: 'Beta',
        __typename: 'GraphqlSoupDocument',
        properties: [{ name: 'body', value: 'page-two' }],
      },
    ]
    const soup = soupPages([
      { cursor: null, items: page1, nextCursor: 'c2' },
      { cursor: 'c2', items: page2, nextCursor: null },
    ])
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    expect(await bridge!.getNote('n2')).toEqual({
      id: 'n2',
      title: 'Beta',
      entityType: 'document',
      typename: 'GraphqlSoupDocument',
      body: 'page-two',
      viewerPermission: null,
    })
    expect(await bridge!.lookupNote('n2')).toEqual({
      status: 'ok',
      document: {
        id: 'n2',
        title: 'Beta',
        entityType: 'document',
        typename: 'GraphqlSoupDocument',
        body: 'page-two',
        viewerPermission: null,
      },
    })
  })

  it('listNotes forwards cursor and limit', async () => {
    const seen: Array<Record<string, unknown> | undefined> = []
    const soup: NotesSoupClient = {
      async queryUserSoupPage(args) {
        seen.push(args?.input)
        return { items: docs, nextCursor: 'next' }
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    const page = await bridge!.listNotes({ cursor: 'c2', limit: 10 })
    expect(page.nextCursor).toBe('next')
    expect(seen[0]).toEqual({ entityType: 'document', limit: 10, cursor: 'c2' })
  })

  it('lookupNote distinguishes denied, not_found, and unavailable', async () => {
    const denied = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: () => 'deny' },
      importsAcl: { canView: () => true },
    })
    expect(await denied!.lookupNote('n1')).toEqual({ status: 'denied' })

    const missing = createNotesBridge({
      enabled: true,
      soup: soupWith(docs),
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    expect(await missing!.lookupNote('missing')).toEqual({ status: 'not_found' })

    const down = createNotesBridge({
      enabled: true,
      soup: {
        async queryUserSoupPage() {
          throw new Error('network down')
        },
      },
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    expect(await down!.lookupNote('n1')).toEqual({ status: 'unavailable', message: 'network down' })
    await expect(down!.getNote('n1')).rejects.toThrow('network down')
  })

  it('lookupNote is incomplete when pagination is capped', async () => {
    const soup: NotesSoupClient = {
      async queryUserSoupPage(args) {
        const cursor = typeof args?.input?.cursor === 'string' ? args.input.cursor : '0'
        const n = Number(cursor)
        return {
          items: [
            {
              id: `p${n}`,
              entityType: 'document',
              displayName: `Page ${n}`,
              __typename: 'GraphqlSoupDocument',
            },
          ],
          nextCursor: String(n + 1),
        }
      },
    }
    const bridge = createNotesBridge({
      enabled: true,
      soup,
      claimLocker: { canRead: () => 'allow' },
      importsAcl: { canView: () => true },
    })
    expect(await bridge!.lookupNote('never')).toEqual({ status: 'incomplete' })
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
