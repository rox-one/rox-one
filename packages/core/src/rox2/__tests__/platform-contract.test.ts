import { describe, expect, test } from 'bun:test'
import type { SoupEntityConcreteType } from '../../conation/soup/types.ts'
import {
  ROX2_ENTITY_KINDS,
  assertRelationKinds,
  fixtureResult,
  formatRox2EntityId,
  formatRox2EntityRef,
  isClaimableLive,
  parseRox2EntityId,
  parseRox2EntityRef,
  queuedResult,
  requiresExplicitGrant,
  simulatedResult,
  soupTypeToRox2Kind,
} from '../platform-contract.ts'
import {
  ROX2_SCHEMA_VERSION,
  createOntologyRecord,
  sha256Json,
  validateOntologyRecord,
} from '../ontology.ts'
import { Rox2IdentityRegistry, Rox2RevisionConflict } from '../identity.ts'

const ALL_SOUP_TYPES: SoupEntityConcreteType[] = [
  'GraphqlSoupDocument',
  'GraphqlSoupChat',
  'GraphqlSoupProject',
  'GraphqlSoupEmailThread',
  'GraphqlSoupChannel',
  'GraphqlSoupChannelMessage',
  'GraphqlSoupCall',
  'GraphqlSoupCalendarEvent',
  'GraphqlSoupCrmCompany',
  'GraphqlSoupForeignEntity',
  'GraphqlSoupReminder',
]

describe('ROX2 platform contract', () => {
  test('maps every Soup concrete type onto a Rox2 entity kind', () => {
    const kinds = ALL_SOUP_TYPES.map((type) => soupTypeToRox2Kind(type))
    expect(kinds).toHaveLength(ALL_SOUP_TYPES.length)
    expect(new Set(kinds).size).toBe(ALL_SOUP_TYPES.length)
    for (const kind of kinds) {
      expect(ROX2_ENTITY_KINDS).toContain(kind)
    }
  })

  test('round-trips entity refs', () => {
    const ref = formatRox2EntityId('mail-thread', 'abc')
    expect(ref).toBe('mail-thread:abc')
    expect(parseRox2EntityId(ref)).toEqual({ kind: 'mail-thread', id: 'abc' })
  })

  test('rejects empty or unknown refs', () => {
    expect(() => formatRox2EntityId('note', '')).toThrow()
    expect(() => parseRox2EntityId('note')).toThrow()
    expect(() => parseRox2EntityId('widget:1')).toThrow()
  })

  test('does not treat queued, simulated, or fixture results as live', () => {
    expect(isClaimableLive(queuedResult('Q', 'queued'))).toBe(false)
    expect(isClaimableLive(simulatedResult('S', 'sim'))).toBe(false)
    expect(isClaimableLive(fixtureResult('F', 'fixture'))).toBe(false)
    expect(
      isClaimableLive({ ok: true, state: 'live', entityId: 'note:1' }),
    ).toBe(true)
  })

  test('sensitive actions require an explicit grant', () => {
    expect(requiresExplicitGrant('read')).toBe(false)
    expect(requiresExplicitGrant('write')).toBe(false)
    expect(requiresExplicitGrant('cloud-send')).toBe(true)
    expect(requiresExplicitGrant('spend')).toBe(true)
    expect(requiresExplicitGrant('destroy')).toBe(true)
  })

  test('round-trips namespaced EntityRef including workspace and revision', () => {
    const ref = { workspaceId: 'ws-a', entityId: 'n1', revisionId: 'r3' }
    const encoded = formatRox2EntityRef('note', ref)
    expect(encoded).toBe('note:ws-a:n1@r3')
    expect(parseRox2EntityRef(encoded)).toEqual({ kind: 'note', ref })
  })

  test('relation domain/range rejects illegal pairs', () => {
    expect(() => assertRelationKinds({ kind: 'assigned' }, 'task', 'person')).not.toThrow()
    expect(() => assertRelationKinds({ kind: 'assigned' }, 'note', 'person')).toThrow(/domain/)
    expect(() => assertRelationKinds({ kind: 'assigned' }, 'task', 'note')).toThrow(/range/)
  })
})

describe('ROX2 identity + ExternalBinding', () => {
  const binding = { provider: 'conation', account: 'acct-a', remoteType: 'document', remoteId: 'soup-1' }

  test('reimport of the same remote binding does not duplicate', () => {
    const registry = new Rox2IdentityRegistry()
    const first = registry.importRecord({
      kind: 'note',
      ref: { workspaceId: 'ws', entityId: 'local-1', revisionId: '1' },
      displayName: 'Alpha',
      binding,
    }, 0)
    const second = registry.importRecord({
      kind: 'note',
      ref: { workspaceId: 'ws', entityId: 'local-2', revisionId: '2' },
      displayName: 'Alpha renamed',
      binding,
    }, 1)
    expect(second.ref.entityId).toBe(first.ref.entityId)
    expect(registry.snapshot().records).toHaveLength(1)
    expect(registry.lookupBinding(binding)?.displayName).toBe('Alpha renamed')
  })

  test('same remoteId on different accounts stays distinct', () => {
    const registry = new Rox2IdentityRegistry()
    registry.importRecord({
      kind: 'note',
      ref: { workspaceId: 'ws', entityId: 'a', revisionId: '1' },
      displayName: 'A',
      binding,
    })
    registry.importRecord({
      kind: 'note',
      ref: { workspaceId: 'ws', entityId: 'b', revisionId: '1' },
      displayName: 'B',
      binding: { ...binding, account: 'acct-b' },
    })
    expect(registry.snapshot().records).toHaveLength(2)
  })

  test('rename preserves EntityRef and binding', () => {
    const registry = new Rox2IdentityRegistry()
    const ref = { workspaceId: 'ws', entityId: 'n1', revisionId: '1' }
    registry.importRecord({ kind: 'note', ref, displayName: 'Old', binding })
    const renamed = registry.rename('note', ref, 'New')
    expect(renamed.ref).toEqual(ref)
    expect(registry.lookupBinding(binding)?.displayName).toBe('New')
    expect(formatRox2EntityRef('note', renamed.ref)).toBe('note:ws:n1@1')
  })

  test('CAS write fails on stale expectedRevision and restore round-trips SHA', () => {
    const registry = new Rox2IdentityRegistry()
    registry.importRecord({
      kind: 'task',
      ref: { workspaceId: 'ws', entityId: 't1', revisionId: '1' },
      displayName: 'Ship',
    })
    const snap = registry.snapshot()
    expect(snap.sha256).toHaveLength(64)
    expect(() =>
      registry.importRecord({
        kind: 'task',
        ref: { workspaceId: 'ws', entityId: 't2', revisionId: '1' },
        displayName: 'Other',
      }, 0),
    ).toThrow(Rox2RevisionConflict)
    const clone = new Rox2IdentityRegistry()
    clone.restore(snap)
    expect(clone.snapshot().sha256).toBe(snap.sha256)
    expect(clone.snapshot().records[0]?.displayName).toBe('Ship')
  })
})

describe('ROX2 ontology schemas', () => {
  test('round-trips properties for every ontology kind', () => {
    const kinds = ['session', 'note', 'task', 'calendar-event', 'person', 'crm-company', 'file', 'outcome', 'workflow'] as const
    for (const kind of kinds) {
      const record = createOntologyRecord({
        kind,
        ref: { workspaceId: 'ws', entityId: `${kind}-1`, revisionId: 'r1' },
        properties: { title: kind, extra: { nested: true } },
        now: 1_700_000_000_000,
      })
      const result = validateOntologyRecord(record)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.record.properties).toEqual({ title: kind, extra: { nested: true } })
    }
  })

  test('unknown schema version quarantines raw without dropping it', () => {
    const raw = {
      schemaVersion: ROX2_SCHEMA_VERSION + 7,
      kind: 'note',
      ref: { workspaceId: 'ws', entityId: 'n1', revisionId: '1' },
      system: { createdAt: 1, updatedAt: 1, source: 'native' },
      properties: { body: 'keep me' },
    }
    const result = validateOntologyRecord(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.quarantine.reason).toBe('unknown-schema-version')
      expect(result.quarantine.raw).toEqual(raw)
      expect(result.quarantine.sha256).toBe(sha256Json(raw))
    }
  })

  test('invalid dates and refs are rejected', () => {
    const base = createOntologyRecord({
      kind: 'event' as never,
      ref: { workspaceId: 'ws', entityId: 'e1', revisionId: '1' },
    })
    expect(validateOntologyRecord({ ...base, kind: 'calendar-event', system: { ...base.system, createdAt: 0 } }).ok).toBe(false)
    expect(validateOntologyRecord({ ...base, kind: 'note', ref: { workspaceId: '', entityId: 'x', revisionId: '1' } }).ok).toBe(false)
  })
})
