import { describe, expect, it } from 'bun:test'

import {
  createRoversCatalogQuery,
  parseRoversCatalog,
  ROVERS_LIST_MAX_LIMIT,
  RoversCatalogError,
  roversList,
  roversSearch,
  roversShow,
  type RoversCatalog,
} from '../index.ts'

function entry(id: string, name: string, category: string, ru: string, en: string): RoversCatalog['entries'][number] {
  return {
    id,
    name,
    category,
    tagline: { ru, en },
    description: { ru: `${ru} — подробнее.`, en: `${en} — details.` },
    icon: `icons/${id}.svg`,
    spdx: 'MIT',
    homepage: `https://example.test/${id}`,
    verified: true,
    deploy: { kind: 'none' },
  }
}

const catalog = parseRoversCatalog({
  version: 1,
  generated_at: '2026-10-10T00:00:00.000Z',
  source: { repo: 'agisota/2026-10-09-rox-rovers', commit: 'b'.repeat(40) },
  entries: [
    entry('qdrant', 'Qdrant', 'vector-db', 'Векторная база', 'Vector database'),
    entry('chroma', 'Chroma', 'vector-db', 'Простая векторная база', 'Simple vector database'),
    entry('ollama', 'Ollama', 'llm-runtime', 'Локальный запуск LLM', 'Run LLMs locally'),
    entry('minio', 'MinIO', 'object-storage', 'S3-хранилище', 'S3-compatible storage'),
  ],
})

const query = createRoversCatalogQuery(catalog)

describe('createRoversCatalogQuery', () => {
  it('lists everything by default with an honest total', () => {
    const result = roversList(query)
    expect(result.total).toBe(4)
    expect(result.entries.map((e) => e.id)).toEqual(['qdrant', 'chroma', 'ollama', 'minio'])
  })

  it('filters by exact category', () => {
    const result = roversList(query, { category: 'vector-db' })
    expect(result.total).toBe(2)
    expect(result.entries.map((e) => e.id)).toEqual(['qdrant', 'chroma'])
  })

  it('applies the limit while still reporting the full match total', () => {
    const result = roversList(query, { category: 'vector-db', limit: 1 })
    expect(result.total).toBe(2)
    expect(result.entries.map((e) => e.id)).toEqual(['qdrant'])
  })

  it('clamps the limit to the hard cap', () => {
    const result = query.list({ limit: 10_000 })
    expect(result.entries.length).toBe(catalog.entries.length)
    expect(ROVERS_LIST_MAX_LIMIT).toBe(100)
  })

  it('matches keyword tokens case-insensitively across both locales', () => {
    expect(roversSearch(query, { query: 'VECTOR' }).entries.map((e) => e.id)).toEqual(['qdrant', 'chroma'])
    expect(roversSearch(query, { query: 'векторная' }).entries.map((e) => e.id)).toEqual(['qdrant', 'chroma'])
    // AND semantics: every token must appear (possibly across locales).
    expect(roversSearch(query, { query: 'vector база' }).entries.map((e) => e.id)).toEqual(['qdrant', 'chroma'])
    expect(roversSearch(query, { query: 'minio s3' }).entries.map((e) => e.id)).toEqual(['minio'])
  })

  it('returns the full entry from show and throws a typed error for an unknown id', () => {
    expect(roversShow(query, { id: 'ollama' }).homepage).toBe('https://example.test/ollama')
    try {
      roversShow(query, { id: 'nope' })
      throw new Error('expected show to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(RoversCatalogError)
      expect((error as RoversCatalogError).code).toBe('ENTRY_NOT_FOUND')
    }
    expect(query.show('nope')).toBeNull()
  })
})