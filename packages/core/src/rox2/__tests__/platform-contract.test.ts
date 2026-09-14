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
  rpcBrowserProfileImportActResult,
  rpcBrowserProfileImportListResult,
  rpcBrowserProfileImportReadResult,
  rpcBundledSkillsActResult,
  rpcBundledSkillsListResult,
  rpcBundledSkillsReadResult,
  rpcCloudRunsActResult,
  rpcCloudRunsListResult,
  rpcCloudRunsReadResult,
  rpcCollectionActResult,
  rpcCollectionListResult,
  rpcCollectionReadResult,
  rpcCommandGatewayActResult,
  rpcCommandGatewayListResult,
  rpcCommandGatewayReadResult,
  rpcContextDocsActResult,
  rpcContextDocsListResult,
  rpcContextDocsReadResult,
  rpcEnvironmentActResult,
  rpcEnvironmentListResult,
  rpcEnvironmentReadResult,
  rpcExtensionsActResult,
  rpcExtensionsListResult,
  rpcExtensionsReadResult,
  rpcFabricRuntimeActResult,
  rpcFabricRuntimeListResult,
  rpcFabricRuntimeReadResult,
  rpcFabricActResult,
  rpcFabricListResult,
  rpcFabricReadResult,
  rpcFilesActResult,
  rpcFilesListResult,
  rpcFilesReadResult,
  rpcGamificationActResult,
  rpcGamificationListResult,
  rpcGamificationReadResult,
  rpcIdentityActResult,
  rpcIdentityListResult,
  rpcIdentityReadResult,
  rpcKanbanActResult,
  rpcKanbanListResult,
  rpcKanbanReadResult,
  rpcKnowledgeActResult,
  rpcKnowledgeListResult,
  rpcKnowledgeReadResult,
  rpcLabelsActResult,
  rpcLabelsListResult,
  rpcLabelsReadResult,
  rpcLlmConnectionsActResult,
  rpcLlmConnectionsListResult,
  rpcLlmConnectionsReadResult,
  rpcMarketplaceActResult,
  rpcMarketplaceListResult,
  rpcMarketplaceReadResult,
  rpcMemoryInsightsActResult,
  rpcMemoryInsightsListResult,
  rpcMemoryInsightsReadResult,
  rpcMemoryIoActResult,
  rpcMemoryIoListResult,
  rpcMemoryIoReadResult,
  rpcMemoryProposalsActResult,
  rpcMemoryProposalsListResult,
  rpcMemoryProposalsReadResult,
  rpcMemoryActResult,
  rpcMemoryListResult,
  rpcMemoryReadResult,
  rpcMessagingActResult,
  rpcMessagingListResult,
  rpcMessagingReadResult,
  rpcMindmapActResult,
  rpcMindmapListResult,
  rpcMindmapReadResult,
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

describe('ROX2-142 RPC browser-profile-import.ts list/read/act', () => {
  test('list names live vs fixture; Conation profile list is not claimable', () => {
    const nativeEmpty = rpcBrowserProfileImportListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcBrowserProfileImportListResult({ source: 'native', nativeIds: ['chromium'] }).result)).toBe(true)
    expect(isClaimableLive(rpcBrowserProfileImportListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBrowserProfileImportListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing profile is not a fake record', () => {
    const found = rpcBrowserProfileImportReadResult({ source: 'native', nativeId: 'chromium' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('file:chromium')
    expect(isClaimableLive(rpcBrowserProfileImportReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcBrowserProfileImportReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcBrowserProfileImportReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBrowserProfileImportReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcBrowserProfileImportActResult({ source: 'native', action: 'write', nativeId: 'chromium' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcBrowserProfileImportActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'chromium' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcBrowserProfileImportActResult({ source: 'native', action: 'destroy', nativeId: 'chromium' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserProfileImportActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserProfileImportActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcBrowserProfileImportActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-143 RPC bundled-skills.ts list/read/act', () => {
  test('list names live vs fixture; Conation skills list is not claimable', () => {
    const nativeEmpty = rpcBundledSkillsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcBundledSkillsListResult({ source: 'native', nativeIds: ['pack'] }).result)).toBe(true)
    expect(isClaimableLive(rpcBundledSkillsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBundledSkillsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing skill is not a fake record', () => {
    const found = rpcBundledSkillsReadResult({ source: 'native', nativeId: 'pack' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('skill:pack')
    expect(isClaimableLive(rpcBundledSkillsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcBundledSkillsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcBundledSkillsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcBundledSkillsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcBundledSkillsActResult({ source: 'native', action: 'write', nativeId: 'pack' }))).toBe(true)
    expect(
      isClaimableLive(rpcBundledSkillsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'pack' })),
    ).toBe(true)
    expect(isClaimableLive(rpcBundledSkillsActResult({ source: 'native', action: 'destroy', nativeId: 'pack' }))).toBe(false)
    expect(isClaimableLive(rpcBundledSkillsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcBundledSkillsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcBundledSkillsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-144 RPC cloud-runs.ts list/read/act', () => {
  test('list names live vs fixture; Conation cloud-runs list is not claimable', () => {
    const nativeEmpty = rpcCloudRunsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcCloudRunsListResult({ source: 'native', nativeIds: ['run-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcCloudRunsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCloudRunsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing run is not a fake record', () => {
    const found = rpcCloudRunsReadResult({ source: 'native', nativeId: 'run-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('workflow:run-1')
    expect(isClaimableLive(rpcCloudRunsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcCloudRunsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcCloudRunsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCloudRunsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcCloudRunsActResult({ source: 'native', action: 'write', nativeId: 'run-1' }))).toBe(true)
    expect(
      isClaimableLive(rpcCloudRunsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'run-1' })),
    ).toBe(true)
    expect(isClaimableLive(rpcCloudRunsActResult({ source: 'native', action: 'destroy', nativeId: 'run-1' }))).toBe(false)
    expect(isClaimableLive(rpcCloudRunsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcCloudRunsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcCloudRunsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-145 RPC collection.ts list/read/act', () => {
  test('list names live vs fixture; Conation collection list is not claimable', () => {
    const nativeEmpty = rpcCollectionListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcCollectionListResult({ source: 'native', nativeIds: ['ws-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcCollectionListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCollectionListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing collection is not a fake record', () => {
    const found = rpcCollectionReadResult({ source: 'native', nativeId: 'ws-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('session:ws-1')
    expect(isClaimableLive(rpcCollectionReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcCollectionReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcCollectionReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCollectionReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcCollectionActResult({ source: 'native', action: 'write', nativeId: 'ws-1' }))).toBe(true)
    expect(
      isClaimableLive(rpcCollectionActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'ws-1' })),
    ).toBe(true)
    expect(isClaimableLive(rpcCollectionActResult({ source: 'native', action: 'destroy', nativeId: 'ws-1' }))).toBe(false)
    expect(isClaimableLive(rpcCollectionActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcCollectionActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcCollectionActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-146 RPC command-gateway.ts list/read/act', () => {
  test('list names live vs fixture; Conation command-gateway list is not claimable', () => {
    const nativeEmpty = rpcCommandGatewayListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcCommandGatewayListResult({ source: 'native', nativeIds: ['cmd-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcCommandGatewayListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCommandGatewayListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing command is not a fake record', () => {
    const found = rpcCommandGatewayReadResult({ source: 'native', nativeId: 'cmd-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('task:cmd-1')
    expect(isClaimableLive(rpcCommandGatewayReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcCommandGatewayReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcCommandGatewayReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcCommandGatewayReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; DTO ok, fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcCommandGatewayActResult({ source: 'native', action: 'write', nativeId: 'cmd-1' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcCommandGatewayActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'cmd-1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcCommandGatewayActResult({ source: 'native', action: 'destroy', nativeId: 'cmd-1' }))).toBe(false)
    expect(isClaimableLive(rpcCommandGatewayActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcCommandGatewayActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcCommandGatewayActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-147 RPC context-docs.ts list/read/act', () => {
  test('list names live vs fixture; Conation context-docs list is not claimable', () => {
    const nativeEmpty = rpcContextDocsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcContextDocsListResult({ source: 'native', nativeIds: ['soul.md'] }).result)).toBe(true)
    expect(isClaimableLive(rpcContextDocsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcContextDocsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing doc is not a fake record', () => {
    const found = rpcContextDocsReadResult({ source: 'native', nativeId: 'soul.md' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('file:soul.md')
    expect(isClaimableLive(rpcContextDocsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcContextDocsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcContextDocsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcContextDocsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcContextDocsActResult({ source: 'native', action: 'write', nativeId: 'soul.md' }))).toBe(true)
    expect(
      isClaimableLive(rpcContextDocsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'soul.md' })),
    ).toBe(true)
    expect(isClaimableLive(rpcContextDocsActResult({ source: 'native', action: 'destroy', nativeId: 'soul.md' }))).toBe(false)
    expect(isClaimableLive(rpcContextDocsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcContextDocsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcContextDocsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-148 RPC environment.ts list/read/act', () => {
  test('list names live vs fixture; Conation environment list is not claimable', () => {
    const nativeEmpty = rpcEnvironmentListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcEnvironmentListResult({ source: 'native', nativeIds: ['prefs'] }).result)).toBe(true)
    expect(isClaimableLive(rpcEnvironmentListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcEnvironmentListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing prefs is not a fake record', () => {
    const found = rpcEnvironmentReadResult({ source: 'native', nativeId: 'prefs' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('memory:prefs')
    expect(isClaimableLive(rpcEnvironmentReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcEnvironmentReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcEnvironmentReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcEnvironmentReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcEnvironmentActResult({ source: 'native', action: 'write', nativeId: 'prefs' }))).toBe(true)
    expect(
      isClaimableLive(rpcEnvironmentActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'prefs' })),
    ).toBe(true)
    expect(isClaimableLive(rpcEnvironmentActResult({ source: 'native', action: 'destroy', nativeId: 'prefs' }))).toBe(false)
    expect(isClaimableLive(rpcEnvironmentActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcEnvironmentActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcEnvironmentActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-149 RPC extensions.ts list/read/act', () => {
  test('list names live vs fixture; Conation extensions list is not claimable', () => {
    const nativeEmpty = rpcExtensionsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcExtensionsListResult({ source: 'native', nativeIds: ['demo-pack'] }).result)).toBe(true)
    expect(isClaimableLive(rpcExtensionsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcExtensionsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing extension is not a fake record', () => {
    const found = rpcExtensionsReadResult({ source: 'native', nativeId: 'state' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('skill:state')
    expect(isClaimableLive(rpcExtensionsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcExtensionsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcExtensionsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcExtensionsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcExtensionsActResult({ source: 'native', action: 'write', nativeId: 'demo-pack' }))).toBe(true)
    expect(
      isClaimableLive(rpcExtensionsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'demo-pack' })),
    ).toBe(true)
    expect(isClaimableLive(rpcExtensionsActResult({ source: 'native', action: 'destroy', nativeId: 'demo-pack' }))).toBe(false)
    expect(isClaimableLive(rpcExtensionsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcExtensionsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcExtensionsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-150 RPC fabric-runtime.ts list/read/act', () => {
  test('list names live vs fixture; Conation fabric-runtime list is not claimable', () => {
    const nativeEmpty = rpcFabricRuntimeListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcFabricRuntimeListResult({ source: 'native', nativeIds: ['runtime'] }).result)).toBe(true)
    expect(isClaimableLive(rpcFabricRuntimeListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFabricRuntimeListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing runtime is not a fake record', () => {
    const found = rpcFabricRuntimeReadResult({ source: 'native', nativeId: 'runtime' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('connection:runtime')
    expect(isClaimableLive(rpcFabricRuntimeReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcFabricRuntimeReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcFabricRuntimeReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFabricRuntimeReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcFabricRuntimeActResult({ source: 'native', action: 'write', nativeId: 'runtime' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcFabricRuntimeActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'runtime' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcFabricRuntimeActResult({ source: 'native', action: 'destroy', nativeId: 'runtime' }))).toBe(false)
    expect(isClaimableLive(rpcFabricRuntimeActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcFabricRuntimeActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcFabricRuntimeActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-151 RPC fabric.ts list/read/act', () => {
  test('list names live vs fixture; Conation fabric list is not claimable', () => {
    const nativeEmpty = rpcFabricListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcFabricListResult({ source: 'native', nativeIds: ['conn-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcFabricListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFabricListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing connection is not a fake record', () => {
    const found = rpcFabricReadResult({ source: 'native', nativeId: 'github' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('connection:github')
    expect(isClaimableLive(rpcFabricReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcFabricReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcFabricReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFabricReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcFabricActResult({ source: 'native', action: 'write', nativeId: 'conn-1' }))).toBe(true)
    expect(
      isClaimableLive(rpcFabricActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'conn-1' })),
    ).toBe(true)
    expect(isClaimableLive(rpcFabricActResult({ source: 'native', action: 'destroy', nativeId: 'conn-1' }))).toBe(false)
    expect(isClaimableLive(rpcFabricActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcFabricActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcFabricActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-152 RPC files.ts list/read/act', () => {
  test('list names live vs fixture; Conation files list is not claimable', () => {
    const nativeEmpty = rpcFilesListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcFilesListResult({ source: 'native', nativeIds: ['readme.md'] }).result)).toBe(true)
    expect(isClaimableLive(rpcFilesListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFilesListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing file is not a fake record', () => {
    const found = rpcFilesReadResult({ source: 'native', nativeId: 'readme.md' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('file:readme.md')
    expect(isClaimableLive(rpcFilesReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcFilesReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcFilesReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcFilesReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcFilesActResult({ source: 'native', action: 'write', nativeId: 'readme.md' }))).toBe(true)
    expect(
      isClaimableLive(rpcFilesActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'readme.md' })),
    ).toBe(true)
    expect(isClaimableLive(rpcFilesActResult({ source: 'native', action: 'destroy', nativeId: 'readme.md' }))).toBe(false)
    expect(isClaimableLive(rpcFilesActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcFilesActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcFilesActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-153 RPC gamification.ts list/read/act', () => {
  test('list names live vs fixture; Conation gamification list is not claimable', () => {
    const nativeEmpty = rpcGamificationListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcGamificationListResult({ source: 'native', nativeIds: ['profile'] }).result)).toBe(true)
    expect(isClaimableLive(rpcGamificationListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcGamificationListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing profile is not a fake record', () => {
    const found = rpcGamificationReadResult({ source: 'native', nativeId: 'profile' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('task:profile')
    expect(isClaimableLive(rpcGamificationReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcGamificationReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcGamificationReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcGamificationReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcGamificationActResult({ source: 'native', action: 'write', nativeId: 'profile' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcGamificationActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'profile' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcGamificationActResult({ source: 'native', action: 'destroy', nativeId: 'profile' }))).toBe(false)
    expect(isClaimableLive(rpcGamificationActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcGamificationActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcGamificationActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-154 RPC identity.ts list/read/act', () => {
  test('list names live vs fixture; Conation identity list is not claimable', () => {
    const nativeEmpty = rpcIdentityListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcIdentityListResult({ source: 'native', nativeIds: ['profile'] }).result)).toBe(true)
    expect(isClaimableLive(rpcIdentityListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcIdentityListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing profile is not a fake record', () => {
    const found = rpcIdentityReadResult({ source: 'native', nativeId: 'profile' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('person:profile')
    expect(isClaimableLive(rpcIdentityReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcIdentityReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcIdentityReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcIdentityReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcIdentityActResult({ source: 'native', action: 'write', nativeId: 'profile' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcIdentityActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'conn-1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcIdentityActResult({ source: 'native', action: 'destroy', nativeId: 'conn-1' }))).toBe(false)
    expect(isClaimableLive(rpcIdentityActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcIdentityActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcIdentityActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-155 RPC kanban.ts list/read/act', () => {
  test('list names live vs fixture; Conation kanban list is not claimable', () => {
    const nativeEmpty = rpcKanbanListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcKanbanListResult({ source: 'native', nativeIds: ['board'] }).result)).toBe(true)
    expect(isClaimableLive(rpcKanbanListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcKanbanListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing board is not a fake record', () => {
    const found = rpcKanbanReadResult({ source: 'native', nativeId: 'board' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('task:board')
    expect(isClaimableLive(rpcKanbanReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcKanbanReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcKanbanReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcKanbanReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcKanbanActResult({ source: 'native', action: 'write', nativeId: 'board' }))).toBe(true)
    expect(
      isClaimableLive(rpcKanbanActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'board' })),
    ).toBe(true)
    expect(isClaimableLive(rpcKanbanActResult({ source: 'native', action: 'destroy', nativeId: 'board' }))).toBe(false)
    expect(isClaimableLive(rpcKanbanActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcKanbanActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcKanbanActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-156 RPC knowledge.ts list/read/act', () => {
  test('list names live vs fixture; Conation knowledge list is not claimable', () => {
    const nativeEmpty = rpcKnowledgeListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcKnowledgeListResult({ source: 'native', nativeIds: ['conn-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcKnowledgeListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcKnowledgeListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing connection is not a fake record', () => {
    const found = rpcKnowledgeReadResult({ source: 'native', nativeId: 'conn-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('note:conn-1')
    expect(isClaimableLive(rpcKnowledgeReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcKnowledgeReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcKnowledgeReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcKnowledgeReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcKnowledgeActResult({ source: 'native', action: 'write', nativeId: 'conn-1' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcKnowledgeActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'proposal-1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcKnowledgeActResult({ source: 'native', action: 'destroy', nativeId: 'proposal-1' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcKnowledgeActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcKnowledgeActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcKnowledgeActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-157 RPC labels.ts list/read/act', () => {
  test('list names live vs fixture; Conation labels list is not claimable', () => {
    const nativeEmpty = rpcLabelsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcLabelsListResult({ source: 'native', nativeIds: ['bug'] }).result)).toBe(true)
    expect(isClaimableLive(rpcLabelsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcLabelsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing label is not a fake record', () => {
    const found = rpcLabelsReadResult({ source: 'native', nativeId: 'bug' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('file:bug')
    expect(isClaimableLive(rpcLabelsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcLabelsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcLabelsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcLabelsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcLabelsActResult({ source: 'native', action: 'write', nativeId: 'bug' }))).toBe(true)
    expect(
      isClaimableLive(rpcLabelsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'bug' })),
    ).toBe(true)
    expect(isClaimableLive(rpcLabelsActResult({ source: 'native', action: 'destroy', nativeId: 'bug' }))).toBe(false)
    expect(isClaimableLive(rpcLabelsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcLabelsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcLabelsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-158 RPC llm-connections.ts list/read/act', () => {
  test('list names live vs fixture; Conation llm-connections list is not claimable', () => {
    const nativeEmpty = rpcLlmConnectionsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcLlmConnectionsListResult({ source: 'native', nativeIds: ['rox-kimi'] }).result)).toBe(true)
    expect(isClaimableLive(rpcLlmConnectionsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcLlmConnectionsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing slug is not a fake record', () => {
    const found = rpcLlmConnectionsReadResult({ source: 'native', nativeId: 'rox-kimi' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('connection:rox-kimi')
    expect(isClaimableLive(rpcLlmConnectionsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcLlmConnectionsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcLlmConnectionsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcLlmConnectionsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcLlmConnectionsActResult({ source: 'native', action: 'write', nativeId: 'rox-kimi' }))).toBe(
      true,
    )
    expect(
      isClaimableLive(
        rpcLlmConnectionsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'rox-kimi' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcLlmConnectionsActResult({ source: 'native', action: 'destroy', nativeId: 'rox-kimi' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcLlmConnectionsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcLlmConnectionsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcLlmConnectionsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-159 RPC marketplace.ts list/read/act', () => {
  test('list names live vs fixture; Conation marketplace list is not claimable', () => {
    const nativeEmpty = rpcMarketplaceListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcMarketplaceListResult({ source: 'native', nativeIds: ['entry-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMarketplaceListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMarketplaceListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing entry is not a fake record', () => {
    const found = rpcMarketplaceReadResult({ source: 'native', nativeId: 'entry-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('skill:entry-1')
    expect(isClaimableLive(rpcMarketplaceReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMarketplaceReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMarketplaceReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMarketplaceReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMarketplaceActResult({ source: 'native', action: 'write', nativeId: 'entry-1' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcMarketplaceActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'entry-1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcMarketplaceActResult({ source: 'native', action: 'destroy', nativeId: 'entry-1' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcMarketplaceActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMarketplaceActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMarketplaceActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-160 RPC memory-insights.ts list/read/act', () => {
  test('list names live vs fixture; Conation memory-insights list is not claimable', () => {
    const nativeEmpty = rpcMemoryInsightsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcMemoryInsightsListResult({ source: 'native', nativeIds: ['insights'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMemoryInsightsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryInsightsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing insights is not a fake record', () => {
    const found = rpcMemoryInsightsReadResult({ source: 'native', nativeId: 'insights' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('memory:insights')
    expect(isClaimableLive(rpcMemoryInsightsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMemoryInsightsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMemoryInsightsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryInsightsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMemoryInsightsActResult({ source: 'native', action: 'write', nativeId: 'onboarded' }))).toBe(
      true,
    )
    expect(
      isClaimableLive(
        rpcMemoryInsightsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'onboarded' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcMemoryInsightsActResult({ source: 'native', action: 'destroy', nativeId: 'onboarded' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcMemoryInsightsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryInsightsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryInsightsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-161 RPC memory-io.ts list/read/act', () => {
  test('list names live vs fixture; Conation memory-io list is not claimable', () => {
    const nativeEmpty = rpcMemoryIoListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcMemoryIoListResult({ source: 'native', nativeIds: ['global'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMemoryIoListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryIoListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing bundle is not a fake record', () => {
    const found = rpcMemoryIoReadResult({ source: 'native', nativeId: 'global' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('memory:global')
    expect(isClaimableLive(rpcMemoryIoReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMemoryIoReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMemoryIoReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryIoReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMemoryIoActResult({ source: 'native', action: 'write', nativeId: 'import' }))).toBe(true)
    expect(
      isClaimableLive(rpcMemoryIoActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'import' })),
    ).toBe(true)
    expect(isClaimableLive(rpcMemoryIoActResult({ source: 'native', action: 'destroy', nativeId: 'import' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryIoActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryIoActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryIoActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-162 RPC memory-proposals.ts list/read/act', () => {
  test('list names live vs fixture; Conation memory-proposals list is not claimable', () => {
    const nativeEmpty = rpcMemoryProposalsListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcMemoryProposalsListResult({ source: 'native', nativeIds: ['p1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMemoryProposalsListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryProposalsListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing proposal is not a fake record', () => {
    const found = rpcMemoryProposalsReadResult({ source: 'native', nativeId: 'p1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('memory:p1')
    expect(isClaimableLive(rpcMemoryProposalsReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMemoryProposalsReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMemoryProposalsReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryProposalsReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMemoryProposalsActResult({ source: 'native', action: 'write', nativeId: 'p1' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcMemoryProposalsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'p1' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcMemoryProposalsActResult({ source: 'native', action: 'destroy', nativeId: 'p1' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcMemoryProposalsActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryProposalsActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryProposalsActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-163 RPC memory.ts list/read/act', () => {
  test('list names live vs fixture; Conation memory list is not claimable', () => {
    const nativeEmpty = rpcMemoryListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(nativeEmpty.result.verification).toBe('receipt_verified')
    expect(isClaimableLive(rpcMemoryListResult({ source: 'native', nativeIds: ['lesson-1'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMemoryListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing context is not a fake record', () => {
    const found = rpcMemoryReadResult({ source: 'native', nativeId: 'global' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('memory:global')
    expect(isClaimableLive(rpcMemoryReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMemoryReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMemoryReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMemoryReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMemoryActResult({ source: 'native', action: 'write', nativeId: 'lesson' }))).toBe(true)
    expect(
      isClaimableLive(rpcMemoryActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'lesson' })),
    ).toBe(true)
    expect(isClaimableLive(rpcMemoryActResult({ source: 'native', action: 'destroy', nativeId: 'lesson' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMemoryActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-164 RPC messaging.ts list/read/act', () => {
  test('list names live vs fixture; Conation messaging list is not claimable', () => {
    const nativeEmpty = rpcMessagingListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcMessagingListResult({ source: 'native', nativeIds: ['telegram'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMessagingListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMessagingListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing bindings is not a fake record', () => {
    const found = rpcMessagingReadResult({ source: 'native', nativeId: 'ws-1' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('connection:ws-1')
    expect(isClaimableLive(rpcMessagingReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMessagingReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMessagingReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMessagingReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMessagingActResult({ source: 'native', action: 'write', nativeId: 'telegram' }))).toBe(true)
    expect(
      isClaimableLive(
        rpcMessagingActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'telegram' }),
      ),
    ).toBe(true)
    expect(isClaimableLive(rpcMessagingActResult({ source: 'native', action: 'destroy', nativeId: 'telegram' }))).toBe(
      false,
    )
    expect(isClaimableLive(rpcMessagingActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMessagingActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMessagingActResult({ source: 'conation' }))).toBe(false)
  })
})

describe('ROX2-165 RPC mindmap.ts list/read/act', () => {
  test('list names live vs fixture; Conation mindmap list is not claimable', () => {
    const nativeEmpty = rpcMindmapListResult({ source: 'native' })
    expect(isClaimableLive(nativeEmpty.result)).toBe(true)
    expect(nativeEmpty.entities).toEqual([])
    expect(isClaimableLive(rpcMindmapListResult({ source: 'native', nativeIds: ['pin'] }).result)).toBe(true)
    expect(isClaimableLive(rpcMindmapListResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMindmapListResult({ source: 'conation' }).result)).toBe(false)
  })

  test('read names live vs fixture; missing pin is not a fake record', () => {
    const found = rpcMindmapReadResult({ source: 'native', nativeId: 'note.json' })
    expect(isClaimableLive(found.result)).toBe(true)
    expect(found.entityId).toBe('note:note.json')
    expect(isClaimableLive(rpcMindmapReadResult({ source: 'native' }).result)).toBe(false)
    expect(rpcMindmapReadResult({ source: 'native' }).entityId).toBeNull()
    expect(isClaimableLive(rpcMindmapReadResult({ source: 'fixture' }).result)).toBe(false)
    expect(isClaimableLive(rpcMindmapReadResult({ source: 'conation' }).result)).toBe(false)
  })

  test('act is live for native write; fixture, ungranted destroy, and spend are not', () => {
    expect(isClaimableLive(rpcMindmapActResult({ source: 'native', action: 'write', nativeId: 'pin' }))).toBe(true)
    expect(
      isClaimableLive(rpcMindmapActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'pin' })),
    ).toBe(true)
    expect(isClaimableLive(rpcMindmapActResult({ source: 'native', action: 'destroy', nativeId: 'pin' }))).toBe(false)
    expect(isClaimableLive(rpcMindmapActResult({ source: 'native', action: 'spend' }))).toBe(false)
    expect(isClaimableLive(rpcMindmapActResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(rpcMindmapActResult({ source: 'conation' }))).toBe(false)
  })
})
