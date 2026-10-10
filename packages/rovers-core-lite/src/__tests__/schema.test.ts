import { describe, expect, it } from 'bun:test'

import { parseRoversCatalog, RoversCatalogValidationError } from '../index.ts'

const base = {
  version: 1,
  generated_at: '2026-10-10T00:00:00.000Z',
  source: { repo: 'agisota/2026-10-09-rox-rovers', commit: 'c'.repeat(40) },
  entries: [
    {
      id: 'qdrant',
      name: 'Qdrant',
      category: 'vector-db',
      tagline: { ru: 'Векторная база', en: 'Vector database' },
      description: { ru: 'Описание', en: 'Description' },
      icon: 'icons/qdrant.svg',
      spdx: 'Apache-2.0',
      homepage: 'https://github.com/qdrant/qdrant',
      verified: true,
      deploy: { kind: 'none' },
    },
  ],
}

describe('parseRoversCatalog', () => {
  it('accepts a v1 catalog', () => {
    expect(parseRoversCatalog(base).entries).toHaveLength(1)
  })

  it('rejects a non-v1 version', () => {
    expect(() => parseRoversCatalog({ ...base, version: 2 })).toThrowError(RoversCatalogValidationError)
  })

  it('rejects duplicate ids', () => {
    expect(() => parseRoversCatalog({ ...base, entries: [...base.entries, ...base.entries] })).toThrowError(
      RoversCatalogValidationError,
    )
  })

  it('rejects unknown keys (wire drift)', () => {
    const entry = { ...base.entries[0], extra: true }
    expect(() => parseRoversCatalog({ ...base, entries: [entry] })).toThrowError(RoversCatalogValidationError)
  })

  it('rejects a non-kebab id and an empty localized string', () => {
    expect(() => parseRoversCatalog({ ...base, entries: [{ ...base.entries[0], id: 'Bad Id' }] })).toThrowError(
      RoversCatalogValidationError,
    )
    expect(() =>
      parseRoversCatalog({ ...base, entries: [{ ...base.entries[0], tagline: { ru: '', en: 'x' } }] }),
    ).toThrowError(RoversCatalogValidationError)
  })
})