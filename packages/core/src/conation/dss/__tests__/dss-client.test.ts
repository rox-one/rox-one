import { describe, expect, it } from 'bun:test'
import { createDssClient } from '../client.ts'
import { DSS_DEFAULT_BASE_URL } from '../types.ts'
import { dssProjectsPath } from '../paths.ts'

describe('createDssClient', () => {
  it('returns null when flag/enabled is false', () => {
    expect(createDssClient({ enabled: false })).toBeNull()
  })

  it('lists projects with mocked fetch when enabled', async () => {
    const fetchMock: typeof fetch = async (input) => {
      expect(String(input)).toBe(`${DSS_DEFAULT_BASE_URL}${dssProjectsPath()}`)
      return new Response(JSON.stringify({ projects: [{ id: 'p1', name: 'Drive' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const client = createDssClient({ enabled: true, fetch: fetchMock })
    expect(client).not.toBeNull()
    const { projects } = await client!.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.id).toBe('p1')
  })

  it('lists entries and fetches content bytes with mocked fetch', async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/entries')) {
        return new Response(
          JSON.stringify({
            entries: [{ path: '/readme.md', kind: 'file', name: 'readme.md' }],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/content')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    }
    const client = createDssClient({ enabled: true, fetch: fetchMock })
    const listed = await client!.listEntries({ projectId: 'p1', path: '/' })
    expect(listed.entries[0]?.path).toBe('/readme.md')
    const bytes = await client!.getEntryContent({ projectId: 'p1', path: '/readme.md' })
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })

  it('surfaces HTTP errors without hitting live network defaults in assert path', async () => {
    const fetchMock: typeof fetch = async () => new Response('', { status: 401 })
    const client = createDssClient({ enabled: true, fetch: fetchMock })
    await expect(client!.listProjects()).rejects.toThrow(/DSS HTTP 401/)
  })
})
