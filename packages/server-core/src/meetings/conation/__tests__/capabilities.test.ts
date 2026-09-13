import { describe, expect, it } from 'bun:test'
import { dispatchConation, describeNativePath } from '../adapters.ts'
import {
  capabilityFor,
  confirmWrite,
  CONATION_FIXTURE_SCHEMA_HASH,
  CONATION_LIVE_SCHEMA_CONFIRMED,
  CONATION_MODULES,
  iframeCountsAsNative,
  listConationModules,
  SOUP_TYPE_COUNT,
  type ConationModuleId,
} from '../capabilities.ts'

const SOUP_IDS: ConationModuleId[] = [
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

describe('conation capability manifest (#376)', () => {
  it('covers all 11 Soup types plus DSS/Board/Fund with explicit status', () => {
    const modules = listConationModules()
    expect(SOUP_TYPE_COUNT).toBe(11)
    expect(SOUP_IDS.every((id) => modules.some((m) => m.id === id))).toBe(true)
    expect(modules.map((m) => m.id)).toEqual([
      ...SOUP_IDS,
      'dss-drive',
      'board',
      'fund',
    ])
    for (const module of modules) {
      expect(module.status).toBeOneOf(['native-fallback', 'read-client', 'blocked', 'unsupported', 'flag-off'])
      expect(module.iframeSatisfiesNative).toBe(false)
      expect(module.secretsInRenderer).toBe(false)
      expect(module.schemaHash).toBeNull()
    }
  })

  it('does not claim live Mail/CRM/Calendar Conation', () => {
    expect(capabilityFor('GraphqlSoupEmailThread').status).toBe('blocked')
    expect(capabilityFor('GraphqlSoupCrmCompany').status).toBe('blocked')
    expect(capabilityFor('GraphqlSoupCalendarEvent').status).toBe('blocked')
    expect(CONATION_LIVE_SCHEMA_CONFIRMED).toBe(false)
  })

  it('keeps license/NOTICE until #333 and never treats iframe as native', () => {
    expect(capabilityFor('GraphqlSoupDocument').licenseNotice).toBe('none-until-333')
    expect(iframeCountsAsNative('board')).toBe(false)
    expect(iframeCountsAsNative('fund')).toBe(false)
  })
})

describe('confirmWrite fail-closed', () => {
  it('rejects missing schema even if a caller claims live confirmation', () => {
    const result = confirmWrite({
      moduleId: 'board',
      operation: 'edit',
      schemaHash: null,
      authPresent: true,
      liveSchemaConfirmed: true,
    })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected deny')
    expect(result.reason).toBe('unsupported-write')
  })

  it('rejects incompatible schema hashes', () => {
    const result = confirmWrite({
      moduleId: 'dss-drive',
      operation: 'upload',
      schemaHash: 'sha256:deadbeef',
      authPresent: true,
      liveSchemaConfirmed: true,
    })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected deny')
    expect(result.reason).toBe('unsupported-write')
  })

  it('rejects missing auth', () => {
    const result = confirmWrite({
      moduleId: 'GraphqlSoupDocument',
      operation: 'edit',
      schemaHash: 'sha256:anything',
      authPresent: false,
    })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected deny')
    expect(result.reason).toBe('no-auth')
  })

  it('rejects unsupported writes (Mail/CRM/Calendar/DSS upload)', () => {
    for (const [moduleId, operation] of [
      ['GraphqlSoupEmailThread', 'send'],
      ['GraphqlSoupCrmCompany', 'edit'],
      ['GraphqlSoupCalendarEvent', 'edit'],
      ['dss-drive', 'upload'],
    ] as const) {
      const result = confirmWrite({
        moduleId,
        operation,
        schemaHash: 'sha256:anything',
        authPresent: true,
        liveSchemaConfirmed: true,
      })
      expect(result.allowed).toBe(false)
    }
  })

  it('never opens live writes from a fixture schema hash', () => {
    const result = confirmWrite({
      moduleId: 'board',
      operation: 'list',
      schemaHash: CONATION_FIXTURE_SCHEMA_HASH,
      authPresent: true,
      liveSchemaConfirmed: true,
    })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected deny')
    expect(result.reason).toBe('fixture-schema-not-live')
  })
})

describe('adapters', () => {
  it('uses native fallback instead of iframe', () => {
    const iframe = dispatchConation({
      moduleId: 'board',
      operation: 'list',
      kind: 'iframe',
      authPresent: true,
    })
    expect(iframe.status).toBe('unsupported')
    expect(iframe.reason).toBe('iframe-is-not-native')
    expect(iframe.live).toBe(false)

    const native = describeNativePath('board')
    expect(native.reason).toBe('native-fallback')
    expect(native.live).toBe(false)
    expect((native.payload as { fallback: string }).fallback).toContain('KanbanBoard')
  })

  it('fails closed on renderer secrets and raw credentials', () => {
    expect(
      dispatchConation({
        moduleId: 'dss-drive',
        operation: 'read',
        kind: 'remote',
        authPresent: true,
        rendererSecret: 'ghp_not_a_real_token',
      }).reason,
    ).toBe('secrets-not-in-renderer')
    expect(
      dispatchConation({
        moduleId: 'dss-drive',
        operation: 'read',
        kind: 'remote',
        authPresent: true,
        credentialRef: 'github-pat-literal',
      }).reason,
    ).toBe('credential-ref-required')
  })

  it('does not invent a write endpoint when mutation is missing', () => {
    const result = dispatchConation({
      moduleId: 'GraphqlSoupEmailThread',
      operation: 'send',
      kind: 'remote',
      authPresent: true,
      schemaHash: CONATION_FIXTURE_SCHEMA_HASH,
    })
    expect(result.live).toBe(false)
    expect(result.status).toBeOneOf(['blocked', 'unsupported', 'denied'])
  })
})
