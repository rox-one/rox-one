import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '../../../../shared/types'
import type { TourObservation } from '../../runtime/hooks'
import { connectionCapabilities, deriveConnectionSignals, resolvePublishedToolSource, sourceReadiness, toggleSourceSelection } from './index'
import { proxyToolName } from '../../../../../../../../packages/shared/src/mcp/proxy-tool-name'

const source = (slug: string, patch: Partial<LoadedSource['config']> = {}, isBuiltin = false): LoadedSource => ({ config: { id: slug, slug, name: slug, type: 'mcp', provider: slug, enabled: true, connectionStatus: 'connected', mcp: { transport: 'http', url: 'https://invalid.test', authType: 'none' }, ...patch }, guide: null, workspaceId: 'w', folderPath: '/unused', workspaceRootPath: '/unused', isBuiltin })
const scope = { workspaceId: 'w', panelId: 'p', sessionId: 's' }
const observation: TourObservation = { binding: { ...scope, clientProfileId: 'c', runToken: 'r' }, operationToken: 'o', at: 1 }

describe('DOMAIN-06 selection and readiness stay separate', () => {
  test('selected built-in source still installing cannot supply readiness or first-conversation gates', () => {
    const caps = connectionCapabilities({ sources: [source('a', { connectionStatus: 'untested' }, true)], selectedSlugs: ['a'] })
    expect(caps['sources.ready']).toEqual({ state: 'pending', reason: 'installing' })
    expect(caps['sessions.available']).toBeUndefined()
    expect(caps['shell.ready']).toBeUndefined()
  })
  test('a selected source requiring credentials is denied, a ready unselected source does not satisfy it', () => {
    const caps = connectionCapabilities({ sources: [source('a', { connectionStatus: 'needs_auth' }), source('b')], selectedSlugs: ['a'] })
    expect(caps['sources.ready']).toEqual({ state: 'denied', reason: 'not-authorized' })
  })
  test('disabled stdio and failed credentials are not ready despite stale connected state', () => {
    expect(sourceReadiness(source('a', { mcp: { transport: 'stdio', command: 'unused', authType: 'none' } }), false).state).toBe('unavailable')
    expect(sourceReadiness(source('a', { mcp: { transport: 'http', authType: 'oauth' }, isAuthenticated: false })).state).toBe('denied')
  })
  test('T-SOURCES-SELECT exact requested payload supports both selection and removal', () => {
    expect(toggleSourceSelection(['b'], 'a')).toEqual(['b', 'a'])
    expect(toggleSourceSelection(['b', 'a'], 'a')).toEqual(['b'])
  })
})

describe('DOMAIN-07 native published tool provenance', () => {
  test('matches canonical sanitized source names and rejects other source/native/user text', () => {
    expect(resolvePublishedToolSource(proxyToolName('my.source', 'fetch data'), ['my.source'])).toBe('my.source')
    for (const tool of ['mcp__b__fetch', 'fetch_a', 'bash', 'mcp__session__source_a', 'mcp__a__', 'mcp__a__fetch content']) expect(resolvePublishedToolSource(tool, ['a'])).toBeNull()
  })
  test('sanitized aliases and nested source prefixes cannot pick a guessed source', () => {
    expect(resolvePublishedToolSource('mcp__my_source__read', ['my.source', 'my_source'])).toBeNull()
    expect(resolvePublishedToolSource('mcp__a__b__read', ['a', 'a__b'])).toBeNull()
  })
  test('exact published inventory resolves collisions and excludes missing or wrong source', () => {
    const published = [{ name: 'mcp__a__read_2', sourceSlug: 'a' }]
    expect(resolvePublishedToolSource('mcp__a__read', ['a'], published)).toBeNull()
    expect(resolvePublishedToolSource('mcp__a__read_2', ['b'], published)).toBeNull()
    expect(resolvePublishedToolSource('mcp__a__read_2', ['a'], published)).toBe('a')
    expect(resolvePublishedToolSource('mcp__a__read_2', ['a', 'b'], [...published, { name: 'mcp__a__read_2', sourceSlug: 'b' }])).toBeNull()
  })
  test('selection/details observation never manufactures a tool-success signal', () => {
    expect(deriveConnectionSignals(observation, scope, { kind: 'source-details', source: source('a'), loading: false }).map(signal => signal.name)).toEqual(['source.details-visible'])
  })
})

describe('T-CONNECTIONS-AUDIT and source/skill observations', () => {
  test('DOMAIN-09 unavailable Fabric never inherits a ready source or AI settings', () => {
    expect(connectionCapabilities({ fabric: 'error', sources: [source('a')] })['connection-fabric.available']).toEqual({ state: 'unavailable', reason: 'api-unavailable' })
    expect(connectionCapabilities({ fabric: 'loading' })['connection-fabric.available']?.state).toBe('pending')
  })
  test('only a ready Audit tab supplies observed evidence, without content or verified milestone', () => {
    for (const state of ['loading', 'error', 'unavailable'] as const) expect(deriveConnectionSignals(observation, scope, { kind: 'audit-view', tab: 'audit', state })).toEqual([])
    expect(deriveConnectionSignals(observation, scope, { kind: 'audit-view', tab: 'services', state: 'ready' })).toEqual([])
    const signals = deriveConnectionSignals(observation, scope, { kind: 'audit-view', tab: 'audit', state: 'ready' })
    expect(signals[0]?.level).toBe('observed')
    expect(Object.keys(signals[0]!)).not.toContain('content')
  })
  test('T-SOURCES-STATUS/T-SOURCES-DETAILS load failure and wrong entity/workspace/panel are ignored', () => {
    const evidence = { kind: 'source-details' as const, source: source('a'), loading: false }
    expect(deriveConnectionSignals(observation, { ...scope, workspaceId: 'other' }, evidence)).toEqual([])
    expect(deriveConnectionSignals(observation, { ...scope, panelId: 'other' }, evidence)).toEqual([])
    expect(deriveConnectionSignals(observation, { ...scope, entityId: 'b' }, evidence)).toEqual([])
    expect(deriveConnectionSignals(observation, scope, { ...evidence, loading: true })).toEqual([])
  })
  test('T-SKILLS-SELECT mounted or deselected skills are never selected evidence', () => {
    expect(deriveConnectionSignals(observation, scope, { kind: 'skill-selection', selected: true, userInitiated: false })).toEqual([])
    expect(deriveConnectionSignals(observation, scope, { kind: 'skill-selection', selected: false, userInitiated: true })).toEqual([])
    expect(deriveConnectionSignals(observation, scope, { kind: 'skill-selection', selected: true, userInitiated: true })[0]?.name).toBe('skill.selected')
  })
})
