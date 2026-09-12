import { describe, expect, it } from 'bun:test'
import { createSoupClient } from '../client.ts'
import { SOUP_GRAPHQL_DEFAULT_ENDPOINT } from '../types.ts'
import type { HttpFetch } from '../../../platform/http-fetch.ts'

describe('createSoupClient', () => {
  it('returns null when flag/enabled is false', () => {
    expect(createSoupClient({ enabled: false })).toBeNull()
  })

  it('pings SoupQueryRoot with mocked fetch when enabled', async () => {
    const fetchMock: HttpFetch = async () =>
      new Response(JSON.stringify({ data: { __typename: 'SoupQueryRoot' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const client = createSoupClient({
      enabled: true,
      fetch: fetchMock,
      endpoint: SOUP_GRAPHQL_DEFAULT_ENDPOINT,
    })
    expect(client).not.toBeNull()
    expect(await client!.ping()).toBe('SoupQueryRoot')
  })

  it('maps user.soup page items from mocked fetch', async () => {
    const fetchMock: HttpFetch = async (_input, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { query: string }
      expect(body.query).toContain('SoupUserPage')
      return new Response(
        JSON.stringify({
          data: {
            user: {
              id: 'u1',
              soup: {
                nextCursor: null,
                items: [
                  {
                    id: 'e1',
                    entityType: 'document',
                    displayName: 'Doc',
                    isFavorited: false,
                    __typename: 'GraphqlSoupDocument',
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const client = createSoupClient({ enabled: true, fetch: fetchMock })
    const page = await client!.queryUserSoupPage()
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toBe('e1')
    expect(page.items[0]?.__typename).toBe('GraphqlSoupDocument')
  })
})
