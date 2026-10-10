import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'bun:test'

import {
  loadRoversCatalog,
  resolveRoversCatalogLocation,
  RoversCatalogError,
  type RoversCatalog,
  type RoversCatalogIntegrity,
  type RoversCatalogProvider,
} from '../index.ts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

function signBody(body: string): string {
  return sign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64')
}

/** Real node-crypto integrity seam (the host injects the marketplace primitives). */
const nodeIntegrity: RoversCatalogIntegrity = {
  verifySignature(body, signatureBase64) {
    const ok = verify(null, Buffer.from(body, 'utf8'), publicKey, Buffer.from(signatureBase64, 'base64'))
    if (!ok) throw new Error('ed25519 signature mismatch')
  },
  sha256Hex(body) {
    return createHash('sha256').update(body, 'utf8').digest('hex')
  },
}

const sampleCatalog: RoversCatalog = {
  version: 1,
  generated_at: '2026-10-10T00:00:00.000Z',
  source: { repo: 'agisota/2026-10-09-rox-rovers', commit: 'a'.repeat(40) },
  entries: [
    {
      id: 'qdrant',
      name: 'Qdrant',
      category: 'vector-db',
      tagline: { ru: 'Векторная база для RAG', en: 'Vector database for RAG' },
      description: { ru: 'Хранит векторы.', en: 'Stores vectors.' },
      icon: 'icons/qdrant.svg',
      spdx: 'Apache-2.0',
      homepage: 'https://github.com/qdrant/qdrant',
      verified: true,
      deploy: { kind: 'none' },
    },
  ],
}

function body(catalog: RoversCatalog = sampleCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

function provider(overrides: Partial<RoversCatalogProvider> & { origin: 'bundled' | 'override' }): RoversCatalogProvider {
  const catalogBody = overrides.readCatalog ? overrides.readCatalog() : body()
  return {
    origin: overrides.origin,
    readCatalog: () => catalogBody,
    readSignature: overrides.readSignature ?? (() => null),
    readDigest: overrides.readDigest ?? (() => null),
  }
}

describe('loadRoversCatalog', () => {
  it('accepts a signed, digested bundled catalog', () => {
    const text = body()
    const catalog = loadRoversCatalog({
      provider: provider({
        origin: 'bundled',
        readCatalog: () => text,
        readSignature: () => `${signBody(text)}\n`,
        readDigest: () => `${nodeIntegrity.sha256Hex(text)}  catalog.json\n`,
      }),
      integrity: nodeIntegrity,
    })
    expect(catalog.entries).toHaveLength(1)
    expect(catalog.entries[0]!.id).toBe('qdrant')
  })

  it('rejects an unsigned bundled catalog', () => {
    expect(() =>
      loadRoversCatalog({ provider: provider({ origin: 'bundled' }), integrity: nodeIntegrity }),
    ).toThrowError(RoversCatalogError)
    try {
      loadRoversCatalog({ provider: provider({ origin: 'bundled' }), integrity: nodeIntegrity })
    } catch (error) {
      expect((error as RoversCatalogError).code).toBe('UNSIGNED_BUNDLED_CATALOG')
    }
  })

  it('rejects a bundled catalog whose signature does not verify', () => {
    const text = body()
    const tampered = `${JSON.stringify({ ...sampleCatalog, generated_at: '2026-10-11T00:00:00.000Z' }, null, 2)}\n`
    try {
      loadRoversCatalog({
        provider: provider({ origin: 'bundled', readCatalog: () => tampered, readSignature: () => signBody(text) }),
        integrity: nodeIntegrity,
      })
      throw new Error('expected load to fail')
    } catch (error) {
      expect((error as RoversCatalogError).code).toBe('SIGNATURE_INVALID')
    }
  })

  it('rejects a bundled catalog whose sha256 sidecar mismatches', () => {
    const text = body()
    try {
      loadRoversCatalog({
        provider: provider({
          origin: 'bundled',
          readCatalog: () => text,
          readSignature: () => signBody(text),
          readDigest: () => `${'0'.repeat(64)}  catalog.json\n`,
        }),
        integrity: nodeIntegrity,
      })
      throw new Error('expected load to fail')
    } catch (error) {
      expect((error as RoversCatalogError).code).toBe('DIGEST_MISMATCH')
    }
  })

  it('rejects corrupt JSON', () => {
    try {
      loadRoversCatalog({
        provider: provider({ origin: 'override', readCatalog: () => '{ not json' }),
        integrity: nodeIntegrity,
      })
      throw new Error('expected load to fail')
    } catch (error) {
      expect((error as RoversCatalogError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects a structurally invalid catalog', () => {
    const invalid = `${JSON.stringify({ ...sampleCatalog, version: 2 }, null, 2)}\n`
    try {
      loadRoversCatalog({
        provider: provider({ origin: 'override', readCatalog: () => invalid }),
        integrity: nodeIntegrity,
      })
      throw new Error('expected load to fail')
    } catch (error) {
      expect((error as RoversCatalogError).code).toBe('INVALID_CATALOG')
    }
  })

  it('accepts an unsigned override catalog (signature check skipped)', () => {
    const catalog = loadRoversCatalog({
      provider: provider({ origin: 'override' }),
      integrity: nodeIntegrity,
    })
    expect(catalog.version).toBe(1)
  })
})

describe('resolveRoversCatalogLocation', () => {
  it('prefers the ROX_ROVERS_CATALOG_PATH override', () => {
    const location = resolveRoversCatalogLocation({
      bundledDir: '/app/resources/rovers',
      env: { ROX_ROVERS_CATALOG_PATH: '/tmp/local/catalog.json' },
    })
    expect(location).toEqual({
      origin: 'override',
      catalogPath: '/tmp/local/catalog.json',
      signaturePath: '/tmp/local/catalog.json.sig',
      digestPath: '/tmp/local/catalog.json.sha256',
    })
  })

  it('falls back to the bundled directory with sibling sidecars', () => {
    const location = resolveRoversCatalogLocation({ bundledDir: '/app/resources/rovers' })
    expect(location).toEqual({
      origin: 'bundled',
      catalogPath: '/app/resources/rovers/catalog.json',
      signaturePath: '/app/resources/rovers/catalog.json.sig',
      digestPath: '/app/resources/rovers/catalog.json.sha256',
    })
  })

  it('returns null when neither the override nor a bundled dir is present', () => {
    expect(resolveRoversCatalogLocation({})).toBeNull()
  })
})