import { describe, expect, test } from 'bun:test'
import type { SoupEntityConcreteType } from '../../conation/soup/types.ts'
import {
  ROX2_ENTITY_KINDS,
  entityRefFromBinding,
  fixtureResult,
  formatRox2EntityId,
  formatRox2ExternalBindingKey,
  isAllowedRox2Relation,
  isClaimableLive,
  parseRox2EntityId,
  parseRox2ExternalBindingKey,
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
  })

  test('relation dictionary allows note→person and forbids task-dependency cycles', () => {
    expect(isAllowedRox2Relation('mentions', 'note', 'person')).toBe(true)
    expect(isAllowedRox2Relation('blocks', 'task', 'task')).toBe(true)
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
})
