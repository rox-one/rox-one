import { describe, expect, test } from 'bun:test'
import type { SoupEntityConcreteType } from '../../conation/soup/types.ts'
import {
  ROX2_ENTITY_KINDS,
  ROX2_SCHEMA_VERSION,
  authorizeRox2Action,
  entityRefFromBinding,
  fixtureResult,
  formatRox2EntityId,
  formatRox2ExternalBindingKey,
  isAllowedRox2Relation,
  isAuditableRox2Event,
  isClaimableLive,
  isRevisionedEntityRef,
  isRox2Error,
  liveResult,
  normalizeRox2Result,
  parseRox2EntityId,
  parseRox2ExternalBindingKey,
  parseRox2TypedRecord,
  queuedResult,
  registerExternalBinding,
  requiresExplicitGrant,
  simulatedResult,
  soupTypeToRox2Kind,
  wouldCreateRelationCycle,
  type Rox2EntityRef,
} from '../platform-contract.ts'

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
      isClaimableLive({
        executionMode: 'live',
        lifecycle: 'succeeded',
        verification: 'receipt_verified',
        entityId: 'note:1',
        receipt: { requestId: 'r1' },
      }),
    ).toBe(true)
  })

  test('live plus failed is not success', () => {
    const failed = liveResult({
      entityId: 'note:1',
      lifecycle: 'failed',
      code: 'write.failed',
      message: 'remote rejected',
    })
    expect(failed.ok).toBe(false)
    expect(failed.lifecycle).toBe('failed')
    expect(isRox2Error(failed)).toBe(true)
    expect(isClaimableLive(failed)).toBe(false)
  })

  test('queued is not an error and is not claimable', () => {
    const queued = queuedResult('Q', 'queued')
    expect(queued.lifecycle).toBe('queued')
    expect(queued.executionMode).toBe('live')
    expect(isRox2Error(queued)).toBe(false)
    expect(queued.ok).not.toBe(false)
    expect(isClaimableLive(queued)).toBe(false)
  })

  test('succeeded without receipt stays unverified and is not claimable', () => {
    const unverified = liveResult({
      entityId: 'note:1',
      lifecycle: 'succeeded',
    })
    expect(unverified.verification).toBe('unverified')
    expect(unverified.lifecycle).toBe('succeeded')
    expect(isClaimableLive(unverified)).toBe(false)
    expect(
      isClaimableLive({
        executionMode: 'live',
        lifecycle: 'succeeded',
        verification: 'unverified',
        entityId: 'note:1',
      }),
    ).toBe(false)
  })

  test('fixture and simulated are never claimable even when succeeded', () => {
    expect(
      isClaimableLive({
        executionMode: 'fixture',
        lifecycle: 'succeeded',
        verification: 'receipt_verified',
        entityId: 'note:1',
        receipt: { requestId: 'fx' },
      }),
    ).toBe(false)
    expect(
      isClaimableLive({
        executionMode: 'simulated',
        lifecycle: 'succeeded',
        verification: 'readback_verified',
        entityId: 'note:1',
        receipt: { requestId: 'sim' },
      }),
    ).toBe(false)
    expect(isClaimableLive(fixtureResult('F', 'fixture'))).toBe(false)
    expect(isClaimableLive(simulatedResult('S', 'sim'))).toBe(false)
  })

  test('live succeeded is claimable only when policy-verified', () => {
    expect(
      isClaimableLive(
        liveResult({
          entityId: 'note:1',
          lifecycle: 'succeeded',
          verification: 'receipt_verified',
          receipt: { requestId: 'r1' },
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        liveResult({
          entityId: 'note:1',
          lifecycle: 'succeeded',
          verification: 'readback_verified',
          receipt: { observedRevision: 'rev-2' },
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive({
        executionMode: 'live',
        lifecycle: 'running',
        verification: 'unverified',
        entityId: 'note:1',
      }),
    ).toBe(false)
    expect(
      isClaimableLive({
        executionMode: 'live',
        lifecycle: 'waiting_approval',
        verification: 'unverified',
      }),
    ).toBe(false)
  })

  test('legacy overloaded run state still type-checks and maps through the adapter', () => {
    const legacyLive: { ok: true; state: 'live'; entityId: string } = {
      ok: true,
      state: 'live',
      entityId: 'note:1',
    }
    const adapted = normalizeRox2Result(legacyLive)
    expect(adapted.executionMode).toBe('live')
    expect(adapted.lifecycle).toBe('succeeded')
    expect(adapted.verification).toBe('unverified')
    expect(isClaimableLive(legacyLive)).toBe(true)
    expect(isClaimableLive(adapted)).toBe(false)
    expect(isRox2Error(legacyLive)).toBe(false)

    const legacyQueued = { ok: false as const, state: 'queued' as const, code: 'Q', message: 'queued' }
    expect(normalizeRox2Result(legacyQueued).lifecycle).toBe('queued')
    expect(isRox2Error(legacyQueued)).toBe(false)
    expect(isClaimableLive(legacyQueued)).toBe(false)
  })

  test('entity permission catalogs are not actor-scoped authorization', () => {
    const entityPermissions = ['write'] as const
    expect(entityPermissions).toContain('write')
    expect(
      authorizeRox2Action({
        actorId: undefined,
        grants: [{ actorId: 'user-1', permission: 'write' }],
        permission: 'write',
      }),
    ).toBe(false)
    expect(
      authorizeRox2Action({
        actorId: 'user-1',
        grants: [],
        permission: 'write',
      }),
    ).toBe(false)
    expect(
      authorizeRox2Action({
        actorId: 'user-1',
        grants: [{ actorId: 'user-1', permission: 'write' }],
        permission: 'write',
      }),
    ).toBe(true)
  })

  test('mutating refs and audit events require revision, account, and causation', () => {
    expect(
      isRevisionedEntityRef({ workspaceId: 'ws-1', entityId: 'note:1' }),
    ).toBe(false)
    expect(
      isRevisionedEntityRef({
        workspaceId: 'ws-1',
        entityId: 'note:1',
        revisionId: 'rev-1',
        accountNamespace: 'work',
      }),
    ).toBe(true)
    expect(
      isAuditableRox2Event({
        id: 'e1',
        entityId: 'note:1',
        type: 'saved',
        at: 1,
        actor: 'user-1',
      }),
    ).toBe(false)
    expect(
      isAuditableRox2Event({
        id: 'e1',
        entityId: 'note:1',
        type: 'saved',
        at: 1,
        actor: 'user-1',
        causationId: 'cause-1',
        correlationId: 'corr-1',
        aggregateRevision: 'rev-1',
      }),
    ).toBe(true)
  })

  test('sensitive actions require an explicit grant', () => {
    expect(requiresExplicitGrant('read')).toBe(false)
    expect(requiresExplicitGrant('write')).toBe(false)
    expect(requiresExplicitGrant('cloud-send')).toBe(true)
    expect(requiresExplicitGrant('spend')).toBe(true)
    expect(requiresExplicitGrant('destroy')).toBe(true)
  })

  test('external bindings namespace remote ids by account', () => {
    const work = formatRox2ExternalBindingKey({
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    })
    const home = formatRox2ExternalBindingKey({
      provider: 'google',
      account: 'home',
      remoteType: 'event',
      remoteId: 'e1',
    })
    expect(work).not.toBe(home)
    expect(parseRox2ExternalBindingKey(work)).toEqual({
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    })
    const workRef = entityRefFromBinding('ws-1', 'calendar-event', {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    }, 'rev-1')
    expect(workRef.entityId).toContain('google:work:event:e1')
    expect(workRef.revisionId).toBe('rev-1')
    expect(workRef.accountNamespace).toBe('work')
    const index = new Map<string, Rox2EntityRef>()
    const first = registerExternalBinding(index, 'ws-1', 'calendar-event', {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    }, 'rev-1')
    const again = registerExternalBinding(index, 'ws-1', 'calendar-event', {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    }, 'rev-2')
    expect(first.status).toBe('ok')
    expect(again.status).toBe('ok')
    if (first.status === 'ok' && again.status === 'ok') {
      expect(again.ref.entityId).toBe(first.ref.entityId)
      expect(again.ref.revisionId).toBe('rev-2')
    }
    index.set('google:work:event:e1', { workspaceId: 'ws-1', entityId: 'calendar-event:other' })
    const clash = registerExternalBinding(index, 'ws-1', 'calendar-event', {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    })
    expect(clash.status).toBe('quarantine')
  })

  test('legacy unencoded four-slot key finds the existing entity after encoded write without forking', () => {
    const binding = {
      provider: 'google',
      account: 'user@x.com',
      remoteType: 'event',
      remoteId: '1',
    }
    const encoded = formatRox2ExternalBindingKey(binding)
    const legacy = 'google:user@x.com:event:1'
    expect(encoded).toBe('google:user%40x.com:event:1')
    expect(legacy).not.toBe(encoded)
    expect(parseRox2ExternalBindingKey(legacy)).toEqual(binding)

    const existingRef: Rox2EntityRef = {
      workspaceId: 'ws-1',
      entityId: 'calendar-event:google:user@x.com:event:1',
      revisionId: 'rev-1',
      accountNamespace: 'user@x.com',
    }
    const index = new Map<string, Rox2EntityRef>([[legacy, existingRef]])
    const again = registerExternalBinding(index, 'ws-1', 'calendar-event', binding, 'rev-2')

    expect(again.status).toBe('ok')
    if (again.status === 'ok') {
      expect(again.ref.entityId).toBe(existingRef.entityId)
      expect(again.ref.revisionId).toBe('rev-2')
    }
    expect(index.get(encoded)?.entityId).toBe(existingRef.entityId)
    expect(index.get(encoded)?.revisionId).toBe('rev-2')
    expect(index.has(legacy)).toBe(false)
    expect(index.size).toBe(1)
  })

  test('legacy unencoded four-slot workspace mismatch quarantines without encoded write', () => {
    const binding = {
      provider: 'google',
      account: 'user@x.com',
      remoteType: 'event',
      remoteId: '1',
    }
    const encoded = formatRox2ExternalBindingKey(binding)
    const legacy = 'google:user@x.com:event:1'
    const index = new Map<string, Rox2EntityRef>([
      [legacy, { workspaceId: 'ws-1', entityId: 'calendar-event:legacy', revisionId: 'rev-1' }],
    ])
    const clash = registerExternalBinding(index, 'ws-2', 'calendar-event', binding, 'rev-2')
    expect(clash.status).toBe('quarantine')
    if (clash.status === 'quarantine') {
      expect(clash.reason).toBe('workspace-mismatch')
      expect(clash.existing.workspaceId).toBe('ws-1')
      expect(clash.existing.revisionId).toBe('rev-1')
    }
    expect(index.has(encoded)).toBe(false)
    expect(index.get(legacy)?.workspaceId).toBe('ws-1')
    expect(index.get(legacy)?.revisionId).toBe('rev-1')
  })

  test('encodes binding slots so colons in account cannot shift parse', () => {
    const binding = {
      provider: 'g',
      account: 'ac:ct',
      remoteType: 'event',
      remoteId: '1',
    }
    const key = formatRox2ExternalBindingKey(binding)
    expect(key).toBe('g:ac%3Act:event:1')
    expect(parseRox2ExternalBindingKey(key)).toEqual(binding)
    expect(() => parseRox2ExternalBindingKey('g:ac:ct:event:1')).toThrow('Invalid external binding key')
    expect(() => parseRox2ExternalBindingKey('google:user@x.com:event:extra:1')).toThrow(
      'Invalid external binding key',
    )
    const stale: Rox2EntityRef = {
      workspaceId: 'ws-1',
      entityId: 'calendar-event:stale',
      revisionId: 'rev-0',
    }
    const index = new Map<string, Rox2EntityRef>([['g:ac:ct:event:1', stale]])
    const minted = registerExternalBinding(index, 'ws-1', 'calendar-event', binding, 'rev-1')
    expect(minted.status).toBe('ok')
    if (minted.status === 'ok') {
      expect(minted.ref.entityId).not.toBe(stale.entityId)
    }
    expect(index.get('g:ac:ct:event:1')?.entityId).toBe(stale.entityId)
    expect(index.get(key)?.entityId).not.toBe(stale.entityId)
  })

  test('round-trips colons in every binding slot', () => {
    const binding = {
      provider: 'p:v',
      account: 'a:c',
      remoteType: 't:y',
      remoteId: 'id:x',
    }
    expect(parseRox2ExternalBindingKey(formatRox2ExternalBindingKey(binding))).toEqual(binding)
  })

  test('rejects invalid percent-encoding and empty slots on read', () => {
    expect(() => parseRox2ExternalBindingKey('g:ac%ZZ:event:1')).toThrow('Invalid external binding key')
    expect(() => parseRox2ExternalBindingKey('g::event:1')).toThrow('Invalid external binding key')
  })

  test('quarantines re-register when workspaceId differs', () => {
    const index = new Map<string, Rox2EntityRef>()
    const binding = {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    }
    const first = registerExternalBinding(index, 'ws-1', 'calendar-event', binding, 'rev-1')
    const second = registerExternalBinding(index, 'ws-2', 'calendar-event', binding, 'rev-2')
    expect(first.status).toBe('ok')
    expect(second.status).toBe('quarantine')
    if (second.status === 'quarantine') {
      expect(second.reason).toBe('workspace-mismatch')
      expect(second.existing.workspaceId).toBe('ws-1')
      expect(second.existing.revisionId).toBe('rev-1')
    }
    expect(index.get(formatRox2ExternalBindingKey(binding))?.workspaceId).toBe('ws-1')
    expect(index.get(formatRox2ExternalBindingKey(binding))?.revisionId).toBe('rev-1')
  })

  test('writes returned revisionId into the index on same-key update', () => {
    const index = new Map<string, Rox2EntityRef>()
    const binding = {
      provider: 'google',
      account: 'work',
      remoteType: 'event',
      remoteId: 'e1',
    }
    const first = registerExternalBinding(index, 'ws-1', 'calendar-event', binding, 'rev-1')
    const again = registerExternalBinding(index, 'ws-1', 'calendar-event', binding, 'rev-2')
    expect(first.status).toBe('ok')
    expect(again.status).toBe('ok')
    if (again.status === 'ok') {
      expect(again.ref.revisionId).toBe('rev-2')
    }
    expect(index.get(formatRox2ExternalBindingKey(binding))?.revisionId).toBe('rev-2')
  })

  test('relation dictionary allows note→person and forbids task-dependency cycles', () => {
    expect(isAllowedRox2Relation('mentions', 'note', 'person')).toBe(true)
    expect(isAllowedRox2Relation('blocks', 'task', 'task')).toBe(true)
    expect(isAllowedRox2Relation('member-of', 'session', 'project')).toBe(true)
    expect(isAllowedRox2Relation('blocks', 'note', 'task')).toBe(false)
    expect(wouldCreateRelationCycle('mentions', [], 'note:a', 'person:b')).toBe(false)
    expect(
      wouldCreateRelationCycle(
        'blocks',
        [{ fromId: 'task:b', toId: 'task:a', kind: 'blocks' }],
        'task:a',
        'task:b',
      ),
    ).toBe(true)
    expect(
      wouldCreateRelationCycle(
        'blocks',
        [{ fromId: 'task:c', toId: 'task:d', kind: 'blocks' }],
        'task:a',
        'task:b',
      ),
    ).toBe(false)
  })

  test('versioned records preserve unknown versions and round-trip properties', () => {
    const parsed = parseRox2TypedRecord({
      schemaVersion: ROX2_SCHEMA_VERSION,
      kind: 'note',
      system: { id: 'n1', workspaceId: 'ws-1', displayName: 'Daily', updatedAt: 1 },
      properties: { body: 'hello' },
      extra: 'kept-out',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.record.properties.body).toBe('hello')
      expect(parsed.record.kind).toBe('note')
    }
    const future = { schemaVersion: ROX2_SCHEMA_VERSION + 1, kind: 'note', payload: { body: 'keep' } }
    const unsupported = parseRox2TypedRecord(future)
    expect(unsupported).toEqual({ ok: false, code: 'unsupported-version', preserved: future })
    expect(parseRox2TypedRecord({ schemaVersion: 1, kind: 'note', system: { id: 'n1', workspaceId: 'ws', displayName: 'x', updatedAt: Number.NaN } }).ok).toBe(false)
  })
})
