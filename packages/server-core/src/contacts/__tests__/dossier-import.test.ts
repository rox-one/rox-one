/**
 * W1-04 (#1501) — MIG-06 Dossier import: one-to-one mapping, verified write,
 * idempotency, private storage, corrupt store never overwritten.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactCardStore, ContactCardStoreError } from '../store.ts'
import { DossierImportError, dossierCardId, importDossier, parseDossierExport } from '../dossier-import.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-contacts-'))
  roots.push(root)
  return root
}

const payload = {
  schemaVersion: 1,
  data: {
    entities: [
      { id: 'e1', name: 'Анна Петрова', kind: 'person', org: 'ООО Ромашка', aliases: ['Аня'], notes: 'любит чай',
        promises: [{ id: 'p1', text: 'Прислать КП', direction: 'mine', done: false, createdAt: 5 }], createdAt: 1000, updatedAt: 2000 },
      { id: 'e2', name: 'ООО Ромашка', kind: 'company', aliases: [], notes: '', promises: [], createdAt: 1000, updatedAt: 1000 },
      { id: 'e3', name: 'Иван', kind: 'person', org: 'Unknown Corp', aliases: [], notes: '', promises: [], createdAt: 0, updatedAt: 0 },
      { id: '', name: 'no id' },
      { id: 'e4', name: '   ' },
      'garbage',
    ],
  },
}

describe('parseDossierExport', () => {
  it('validates the envelope and skips rows without id / name', () => {
    const parsed = parseDossierExport(payload)
    expect(parsed.entities.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(parsed.skipped).toBe(3)
  })

  it('rejects bad envelopes', () => {
    expect(() => parseDossierExport(null)).toThrow(DossierImportError)
    expect(() => parseDossierExport({ schemaVersion: 2, data: { entities: [] } })).toThrow('UNSUPPORTED_VERSION')
    expect(() => parseDossierExport({ schemaVersion: 1, data: { entities: 'x' } })).toThrow('INVALID_PAYLOAD')
    expect(() => parseDossierExport({ schemaVersion: 1, data: { entities: Array(5001).fill({}) } })).toThrow('TOO_LARGE')
  })
})

describe('importDossier', () => {
  it('maps every entity one-to-one and verifies the write', () => {
    const root = tempRoot()
    const store = new ContactCardStore(root)
    const result = importDossier(store, payload, { workspaceId: 'ws', ownerId: 'local', now: () => 9_000 })
    expect(result).toMatchObject({ total: 3, created: 3, updated: 0, unchanged: 0, skipped: 3, verified: true })
    const cards = store.list()
    const anna = cards.find(c => c.displayName === 'Анна Петрова')!
    expect(anna).toMatchObject({
      contactCardId: dossierCardId('ws', 'e1'),
      kind: 'person',
      ownerScope: 'personal',
      ownerId: 'local',
      principalId: null,
      companyCardId: dossierCardId('ws', 'e2'),
      notes: 'любит чай',
      createdAt: new Date(1000).toISOString(),
      updatedAt: new Date(2000).toISOString(),
    })
    expect(anna.fields).toEqual({
      source: 'dossier', dossierId: 'e1', aliases: ['Аня'], org: 'ООО Ромашка',
      promises: [{ id: 'p1', text: 'Прислать КП', direction: 'mine', done: false, createdAt: 5 }],
    })
    // An org without a company entity is kept as text, never invented as a card.
    const ivan = cards.find(c => c.displayName === 'Иван')!
    expect(ivan.companyCardId).toBeNull()
    expect(ivan.fields.org).toBe('Unknown Corp')
    expect(cards).toHaveLength(3)
  })

  it('is idempotent and bumps the revision of changed cards only', () => {
    const root = tempRoot()
    const store = new ContactCardStore(root)
    importDossier(store, payload, { workspaceId: 'ws', ownerId: 'local' })
    const again = importDossier(store, payload, { workspaceId: 'ws', ownerId: 'local' })
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3, verified: true })
    const changed = structuredClone(payload)
    changed.data.entities[0] = { ...(changed.data.entities[0] as object), notes: 'пьёт кофе' } as never
    const third = importDossier(store, changed, { workspaceId: 'ws', ownerId: 'local' })
    expect(third).toMatchObject({ created: 0, updated: 1, unchanged: 2, verified: true })
    expect(store.get(dossierCardId('ws', 'e1'))).toMatchObject({ notes: 'пьёт кофе', revision: 2 })
  })

  it('stores cards privately under <workspaceRoot>/.rox/contacts', () => {
    const root = tempRoot()
    const store = new ContactCardStore(root)
    importDossier(store, payload, { workspaceId: 'ws', ownerId: 'local' })
    expect(store.filePath).toBe(join(root, '.rox', 'contacts', 'cards.json'))
    if (process.platform !== 'win32') {
      expect(statSync(join(root, '.rox')).mode & 0o777).toBe(0o700)
      expect(statSync(join(root, '.rox', 'contacts')).mode & 0o777).toBe(0o700)
      expect(statSync(store.filePath).mode & 0o777).toBe(0o600)
    }
    expect(JSON.parse(readFileSync(store.filePath, 'utf-8')).version).toBe(1)
  })

  it('never overwrites a corrupt store', () => {
    const root = tempRoot()
    mkdirSync(join(root, '.rox', 'contacts'), { recursive: true })
    const file = join(root, '.rox', 'contacts', 'cards.json')
    writeFileSync(file, '{not json')
    expect(() => importDossier(new ContactCardStore(root), payload, { workspaceId: 'ws', ownerId: 'local' })).toThrow(ContactCardStoreError)
    expect(readFileSync(file, 'utf-8')).toBe('{not json')
  })

  it('an empty export verifies without writing', () => {
    const root = tempRoot()
    const store = new ContactCardStore(root)
    expect(importDossier(store, { schemaVersion: 1, data: { entities: [] } }, { workspaceId: 'ws', ownerId: 'local' }))
      .toMatchObject({ total: 0, verified: true })
    expect(store.list()).toEqual([])
  })
})
