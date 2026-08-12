/**
 * KnowledgeNotebookTree logic tests — the navigator sections' data plumbing:
 * notebooks via the knowledge:listNotebooks RPC (honest unavailable/empty states),
 * recent + favorites derived from work envelopes (flagged / updatedAt ordering),
 * saved views from views.json. No DOM — helpers only (KnowledgeHome precedent).
 */
import { describe, expect, it } from 'bun:test'
import type { KnowledgeNotebookInfo, KnowledgeWorkEnvelope } from '../../../shared/types'
import {
  loadKnowledgeNavigatorData,
  selectFavoriteEnvelopes,
  selectRecentEnvelopes,
  type KnowledgeNavigatorApi,
} from '../KnowledgeNotebookTree'

function envelope(id: string, overrides: Partial<KnowledgeWorkEnvelope> = {}): KnowledgeWorkEnvelope {
  return {
    knowledgeRef: { scheme: 'siyuan', kind: 'document', id },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

const NOTEBOOKS: KnowledgeNotebookInfo[] = [
  { id: 'nb-1', name: 'Research', icon: '1f4da', closed: false },
  { id: 'nb-2', name: 'Inbox', icon: '', closed: true },
]

function apiDouble(overrides: Partial<KnowledgeNavigatorApi> = {}): KnowledgeNavigatorApi {
  return {
    async listConnections() {
      return [{ id: 'conn-1' }]
    },
    async listNotebooks() {
      return NOTEBOOKS
    },
    async viewsList() {
      return []
    },
    async envelopeList() {
      return []
    },
    async get() {
      throw new Error('not found')
    },
    ...overrides,
  }
}

describe('selectRecentEnvelopes', () => {
  it('sorts by updatedAt desc, drops archived, and caps at the limit', () => {
    const envelopes = [
      envelope('a', { updatedAt: 100 }),
      envelope('b', { updatedAt: 300 }),
      envelope('c', { updatedAt: 200, archived: true }),
      envelope('d', { updatedAt: 400 }),
    ]
    const recent = selectRecentEnvelopes(envelopes, 2)
    expect(recent.map((e) => e.knowledgeRef.id)).toEqual(['d', 'b'])
  })

  it('returns an empty list for no envelopes', () => {
    expect(selectRecentEnvelopes([], 10)).toEqual([])
  })
})

describe('selectFavoriteEnvelopes', () => {
  it('keeps only flagged, non-archived envelopes, newest first', () => {
    const envelopes = [
      envelope('a', { flagged: true, updatedAt: 100 }),
      envelope('b', { flagged: false, updatedAt: 900 }),
      envelope('c', { flagged: true, updatedAt: 500 }),
      envelope('d', { flagged: true, updatedAt: 700, archived: true }),
    ]
    const favorites = selectFavoriteEnvelopes(envelopes)
    expect(favorites.map((e) => e.knowledgeRef.id)).toEqual(['c', 'a'])
  })
})

describe('loadKnowledgeNavigatorData', () => {
  it('returns notebooks, views, and envelope rows with resolved titles', async () => {
    const api = apiDouble({
      async viewsList() {
        return [
          { id: 'v-1', name: 'Stale docs', domain: 'knowledge' },
          // Non-knowledge domain views must not leak into the knowledge navigator.
          { id: 'v-2', name: 'Sessions view', domain: 'sessions' },
        ] as never
      },
      async envelopeList() {
        return [
          envelope('doc-fav', { flagged: true, updatedAt: 500 }),
          envelope('doc-recent', { updatedAt: 900 }),
        ]
      },
      async get(args: { ref: { id: string } }) {
        return { title: `Title of ${args.ref.id}` } as never
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks).toEqual({ status: 'ok', items: NOTEBOOKS })
    expect(data.views.map((v) => v.id)).toEqual(['v-1'])
    expect(data.favorites.map((r) => r.envelope.knowledgeRef.id)).toEqual(['doc-fav'])
    expect(data.favorites[0]!.title).toBe('Title of doc-fav')
    expect(data.recent.map((r) => r.envelope.knowledgeRef.id)).toEqual(['doc-recent', 'doc-fav'])
  })

  it('marks notebooks empty when the kernel has none', async () => {
    const data = await loadKnowledgeNavigatorData(apiDouble({ async listNotebooks() { return [] } }))
    expect(data.notebooks).toEqual({ status: 'empty', items: [] })
  })

  it('marks notebooks unavailable (typed, never thrown) when the RPC fails', async () => {
    const api = apiDouble({
      async listNotebooks() {
        throw new Error('CONNECTION_UNAVAILABLE: kernel offline')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
    expect(data.notebooks.items).toEqual([])
  })

  it('marks notebooks unavailable when the preload predates the channel', async () => {
    const api = apiDouble({ listNotebooks: undefined })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
  })

  it('marks notebooks unavailable when no connection is configured', async () => {
    const api = apiDouble({ async listConnections() { return [] } })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
  })

  it('fails soft to empty views/envelopes when those channels error', async () => {
    const api = apiDouble({
      async viewsList() {
        throw new Error('boom')
      },
      async envelopeList() {
        throw new Error('boom')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.views).toEqual([])
    expect(data.recent).toEqual([])
    expect(data.favorites).toEqual([])
    expect(data.notebooks.status).toBe('ok')
  })

  it('keeps rows usable when title resolution fails (fail-soft per row)', async () => {
    const api = apiDouble({
      async envelopeList() {
        return [envelope('doc-x', { flagged: true, updatedAt: 5 })]
      },
      async get() {
        throw new Error('kernel gone')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.favorites).toHaveLength(1)
    expect(data.favorites[0]!.title).toBeUndefined()
  })
})
