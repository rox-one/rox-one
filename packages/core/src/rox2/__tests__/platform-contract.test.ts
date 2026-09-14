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
import {
  soupDocumentActResult,
  soupDocumentListResult,
  soupDocumentReadResult,
} from '../soup-document-actions.ts'
import {
  soupChatActResult,
  soupChatListResult,
  soupChatReadResult,
  soupProjectActResult,
  soupProjectListResult,
  soupProjectReadResult,
} from '../soup-native-actions.ts'
import {
  rpcAuthActResult,
  rpcAuthListResult,
  rpcAuthReadResult,
  rpcAutomationsActResult,
  rpcAutomationsListResult,
  rpcAutomationsReadResult,
  rpcBrowserPaneActResult,
  rpcBrowserPaneListResult,
  rpcBrowserPaneReadResult,
} from '../rpc-native-actions.ts'

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
    expect(failed.state).not.toBe('live')
    expect(isRox2Error(failed)).toBe(true)
    expect(isClaimableLive(failed)).toBe(false)
  })

  test('queued is not an error and is not claimable', () => {
    const queued = queuedResult('Q', 'queued')
    expect(queued.lifecycle).toBe('queued')
    expect(queued.executionMode).toBe('live')
    expect(isRox2Error(queued)).toBe(false)
    expect(queued.ok).toBe(false)
    expect(isClaimableLive(queued)).toBe(false)
  })

  test('fixture and queued results are non-success for ok', () => {
    const fixture = fixtureResult('F', 'fixture')
    const queued = queuedResult('Q', 'queued')
    const simulated = simulatedResult('S', 'sim')
    expect(fixture.ok).toBe(false)
    expect(queued.ok).toBe(false)
    expect(simulated.ok).toBe(false)
    expect(fixture.state).toBe('fixture')
    expect(queued.state).toBe('queued')
    expect(isClaimableLive(fixture)).toBe(false)
    expect(isClaimableLive(queued)).toBe(false)
  })

  test('succeeded without receipt stays unverified and is not claimable', () => {
    const unverified = liveResult({
      entityId: 'note:1',
      lifecycle: 'succeeded',
    })
    expect(unverified.verification).toBe('unverified')
    expect(unverified.lifecycle).toBe('succeeded')
    expect(unverified.ok).not.toBe(true)
    expect(unverified.state).not.toBe('live')
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
    const receiptLive = liveResult({
      entityId: 'note:1',
      lifecycle: 'succeeded',
      verification: 'receipt_verified',
      receipt: { requestId: 'r1' },
    })
    expect(receiptLive.ok).toBe(true)
    expect(receiptLive.state).toBe('live')
    expect(isClaimableLive(receiptLive)).toBe(true)
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
    expect(isClaimableLive(legacyLive)).toBe(false)
    expect(isClaimableLive(adapted)).toBe(false)
    expect(adapted.ok).not.toBe(true)
    expect(adapted.state).not.toBe('live')
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

describe('ROX2-078..080 GraphqlSoupDocument list/read/act', () => {
  test('list names live vs fixture; Soup list is not claimable', () => {
    const nativeEmpty = soupDocumentListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')

    const nativeRows = soupDocumentListResult({ source: 'native', nativeIds: ['daily'] })
    expect(isClaimableLive(nativeRows.result)).toBe(true)
    expect(nativeRows.entities).toEqual(['daily'])

    expect(isClaimableLive(soupDocumentListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupDocumentListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing entity is not a fake record', () => {
    const found = soupDocumentReadResult({ source: 'native', nativeId: 'daily' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('note:daily')

    const missing = soupDocumentReadResult({ source: 'native' })
    expect(isClaimableLive(missing.result)).toBe(false)
    expect(missing.entityId).toBeNull()

    expect(isClaimableLive(soupDocumentReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupDocumentReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; Soup, fixture, ungranted destroy, and spend are not', () => {
    expect(
      isClaimableLive(soupDocumentActResult({ source: 'native', action: 'write', nativeId: 'daily' })),
    ).toBe(true)
    expect(
      isClaimableLive(
        soupDocumentActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'daily' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(soupDocumentActResult({ source: 'native', action: 'destroy', nativeId: 'daily' })),
    ).toBe(false)
    expect(isClaimableLive(soupDocumentActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(soupDocumentActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(soupDocumentActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-081..083 GraphqlSoupChat list/read/act', () => {
  test('list names live vs fixture; Soup chat list is not claimable', () => {
    const nativeEmpty = soupChatListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(soupChatListResult({ source: 'native', nativeIds: ['s1'] }).result)).toBe(true)
    expect(isClaimableLive(soupChatListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupChatListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing session is not a fake record', () => {
    const found = soupChatReadResult({ source: 'native', nativeId: 's1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('session:s1')
    expect(isClaimableLive(soupChatReadResult({ source: 'native' }).result)).toBe(false)
    expect(soupChatReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(soupChatReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupChatReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; Soup, fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(soupChatActResult({ source: 'native', action: 'write', nativeId: 's1' }))).toBe(true)
    expect(
      isClaimableLive(soupChatActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 's1' })),
    ).toBe(true)
    expect(isClaimableLive(soupChatActResult({ source: 'native', action: 'destroy', nativeId: 's1' }))).toBe(false)
    expect(isClaimableLive(soupChatActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(soupChatActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(soupChatActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-084..086 GraphqlSoupProject list/read/act', () => {
  test('list names live vs fixture; Soup project list is not claimable', () => {
    const nativeEmpty = soupProjectListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(soupProjectListResult({ source: 'native', nativeIds: ['alpha'] }).result)).toBe(true)
    expect(isClaimableLive(soupProjectListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupProjectListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing project is not a fake record', () => {
    const found = soupProjectReadResult({ source: 'native', nativeId: 'alpha' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('project:alpha')
    expect(isClaimableLive(soupProjectReadResult({ source: 'native' }).result)).toBe(false)
    expect(soupProjectReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(soupProjectReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(soupProjectReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; Soup, fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(soupProjectActResult({ source: 'native', action: 'write', nativeId: 'alpha' }))).toBe(true)
    expect(
      isClaimableLive(
        soupProjectActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'alpha' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(soupProjectActResult({ source: 'native', action: 'destroy', nativeId: 'alpha' }))).toBe(false)
    expect(isClaimableLive(soupProjectActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(soupProjectActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(soupProjectActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-139 RPC auth.ts list/read/act', () => {
  test('list names live vs fixture; Conation auth list is not claimable', () => {
    const nativeEmpty = rpcAuthListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcAuthListResult({ source: 'native', nativeIds: ['logout'] }).result)).toBe(true)
    expect(isClaimableLive(rpcAuthListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcAuthListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing credential is not a fake record', () => {
    const found = rpcAuthReadResult({ source: 'native', nativeId: 'migration' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('connection:migration')
    expect(isClaimableLive(rpcAuthReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcAuthReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcAuthReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcAuthReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; DTO, fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcAuthActResult({ source: 'native', action: 'write', nativeId: 'migration' }))).toBe(true)
    expect(
      isClaimableLive(rpcAuthActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'logout' })),
    ).toBe(true)
    expect(isClaimableLive(rpcAuthActResult({ source: 'native', action: 'destroy', nativeId: 'logout' }))).toBe(false)
    expect(isClaimableLive(rpcAuthActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcAuthActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcAuthActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-140 RPC automations.ts list/read/act', () => {
  test('list names live vs fixture; Conation automations list is not claimable', () => {
    const nativeEmpty = rpcAutomationsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcAutomationsListResult({ source: 'native', nativeIds: ['cron'] }).result)).toBe(true)
    expect(isClaimableLive(rpcAutomationsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcAutomationsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing automation is not a fake record', () => {
    const found = rpcAutomationsReadResult({ source: 'native', nativeId: 'cron' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('automation:cron')
    expect(isClaimableLive(rpcAutomationsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcAutomationsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcAutomationsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcAutomationsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: 'cron' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcAutomationsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'cron' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcAutomationsActResult({ source: 'native', action: 'destroy', nativeId: 'cron' }))).toBe(false)
    expect(isClaimableLive(rpcAutomationsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcAutomationsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcAutomationsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-141 RPC browser-pane.ts list/read/act', () => {
  test('list names live vs fixture; Conation browser-pane list is not claimable', () => {
    const nativeEmpty = rpcBrowserPaneListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcBrowserPaneListResult({ source: 'native', nativeIds: ['pane-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcBrowserPaneListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBrowserPaneListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing pane is not a fake record', () => {
    const found = rpcBrowserPaneReadResult({ source: 'native', nativeId: 'pane-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('page:pane-1')
    expect(isClaimableLive(rpcBrowserPaneReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcBrowserPaneReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcBrowserPaneReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBrowserPaneReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcBrowserPaneActResult({ source: 'native', action: 'write', nativeId: 'pane-1' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcBrowserPaneActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'pane-1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcBrowserPaneActResult({ source: 'native', action: 'destroy', nativeId: 'pane-1' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserPaneActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserPaneActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserPaneActResult({ source: 'conation' }))).toBe(false)
  })
})
