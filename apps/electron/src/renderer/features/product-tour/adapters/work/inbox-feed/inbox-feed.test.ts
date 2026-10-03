import { describe, expect, test } from 'bun:test'
import type { FeedItem } from '@rox/shared/feed'
import type { TourBinding, TourScope } from '../../../contracts'
import type { TourObservation } from '../../../runtime/hooks'
import { deriveInboxFeedSignals, inboxFeedCapabilities, createFeedReaderObserver } from './index'
import { markDone, snooze } from '@/pages/inbox/inbox-model'

const scope: TourScope = { workspaceId: 'workspace-a', panelId: 'panel-a' }
const binding: TourBinding = { ...scope, clientProfileId: 'profile-a', runToken: 'run-a' }
const observation: TourObservation = { binding, operationToken: 'operation-a', at: 100 }
const article: FeedItem = { id: 'news:real-source:article', tab: 'news', kind: 'news', title: 'Private title', summary: 'Private article', at: 50, url: 'https://private.example/article', sourceId: 'source-a' }
const evidence = (overrides = {}) => ({ kind: 'feed-reader-rendered' as const, scope, expected: article, rendered: article, readerVisible: true, loaded: true, ...overrides })
const ready = { workspacePresent: true, inboxApi: true, inboxLoaded: true, inboxFailed: false, feedApi: true, feedLoaded: true, feedFailed: false, feedItems: [article] }

describe('Inbox/Feed native evidence', () => {
  test('T-FEED-READ: current rendered publication is observed with its original operation', () => {
    const [signal] = deriveInboxFeedSignals(observation, evidence(), 200)
    expect(signal).toEqual({ name: 'feed.item-opened', level: 'observed', origin: 'ui-observation', binding, operationToken: 'operation-a', operationStartedAt: 100, eventToken: expect.any(String), at: 200 })
    expect(JSON.stringify(signal)).not.toContain('Private')
    expect(JSON.stringify(signal)).not.toContain('https:')
    expect(JSON.stringify(signal)).not.toContain(article.id)
  })
  test('stale selection, changed version and foreign native scopes cannot finish reading', () => {
    for (const change of [
      { rendered: null }, { rendered: { ...article, id: 'other' } },
      { rendered: { ...article, summary: 'A newer version' } },
      { rendered: { ...article, at: 51 } }, { scope: { ...scope, workspaceId: 'workspace-b' } },
      { scope: { ...scope, panelId: 'panel-b' } }, { scope: { ...scope, sessionId: 'foreign-session' } },
      { rendered: { ...article, ref: { type: 'source', id: 'source-a', workspaceId: 'workspace-b' } } },
      { readerVisible: false }, { loaded: false }, { failed: true },
    ]) expect(deriveInboxFeedSignals(observation, evidence(change), 200)).toEqual([])
    expect(deriveInboxFeedSignals(null, evidence(), 200)).toEqual([])
    expect(deriveInboxFeedSignals({ ...observation, binding: { ...binding, entityId: 'bound-item' } }, evidence({ scope: { ...scope, entityId: 'foreign-item' } }), 200)).toEqual([])
  })
  test('session activity is not a publication and Inbox triage never resolves a permission', () => {
    const session: FeedItem = { id: 'session:1', tab: 'agents', kind: 'session', title: 'Reply', at: 50 }
    expect(deriveInboxFeedSignals(observation, evidence({ expected: session, rendered: session }), 200)).toEqual([])
    const initial = { done: {}, snoozed: {} }
    expect(markDone(initial, 'permission:request', 100).done['permission:request']).toBe(100)
    expect(snooze(initial, 'permission:request', 1000).snoozed['permission:request']).toBe(1000)
    for (const action of ['done', 'snooze'] as const) expect(deriveInboxFeedSignals(observation, { kind: 'inbox-triage', action, scope }, 200)).toEqual([])
  })
  test('observer only arms on native selection, ignores prior reader and emits once after render', () => {
    const observer = createFeedReaderObserver()
    expect(observer.rendered(article, scope, true, true, false, 200)).toEqual([])
    observer.select(observation, article, scope)
    expect(observer.rendered(article, scope, false, true, false, 200)).toEqual([])
    expect(observer.rendered(article, { ...scope, entityId: article.id }, true, true, false, 201)).toHaveLength(1)
    expect(observer.rendered(article, scope, true, true, false, 202)).toEqual([])
  })
  test('operation stays tied to the original run, and newer user selection replaces old operation', () => {
    const observer = createFeedReaderObserver()
    observer.select(observation, article, scope)
    const next = { ...observation, binding: { ...binding, runToken: 'run-b' }, operationToken: 'operation-b', at: 150 }
    const newer = { ...article, id: 'news:new', summary: 'New article' }
    observer.select(next, newer, scope)
    expect(observer.rendered(article, scope, true, true, false, 200)).toEqual([])
    const [signal] = observer.rendered(newer, scope, true, true, false, 201)
    expect(signal?.binding.runToken).toBe('run-b')
    expect(signal?.operationToken).toBe('operation-b')
    observer.select(observation, article, scope)
    const [late] = observer.rendered(article, scope, true, true, false, 210)
    expect(late?.binding.runToken).toBe('run-a')
    observer.select(observation, article, scope)
    observer.clear()
    expect(observer.rendered(article, scope, true, true, false, 220)).toEqual([])
  })
  test('observer keeps native state immutable and never manufactures material', () => {
    const native = Object.freeze({ ...article })
    const before = JSON.stringify(native)
    const observer = createFeedReaderObserver()
    observer.select(null, native, scope)
    expect(observer.rendered(native, scope, true, true, false, 200)).toEqual([])
    observer.select(observation, native, scope)
    observer.rendered(native, scope, true, true, false, 201)
    expect(JSON.stringify(native)).toBe(before)
    expect(observer.rendered(null, scope, true, true, false, 202)).toEqual([])
  })
})

describe('Inbox/Feed capabilities', () => {
  test('T-INBOX-QUEUE/TRIAGE: a successfully loaded empty Inbox can be explained', () => {
    expect(inboxFeedCapabilities(ready)['inbox.available']).toEqual({ state: 'ready' })
    expect(inboxFeedCapabilities({ ...ready, inboxFailed: true })['inbox.available']).toEqual({ state: 'unavailable', reason: 'network-unavailable' })
  })
  test('DOMAIN-17: empty Feed stays a prerequisite, unavailable transport never becomes content', () => {
    expect(inboxFeedCapabilities({ ...ready, feedItems: [] })['feed.available']).toEqual({ state: 'pending', reason: 'missing-entity' })
    expect(inboxFeedCapabilities({ ...ready, feedApi: false })['feed.available']).toEqual({ state: 'unavailable', reason: 'api-unavailable' })
    expect(inboxFeedCapabilities({ ...ready, feedFailed: true })['feed.available']).toEqual({ state: 'unavailable', reason: 'network-unavailable' })
    expect(inboxFeedCapabilities({ ...ready, feedLoaded: false })['feed.available']).toEqual({ state: 'pending', reason: 'installing' })
    expect(inboxFeedCapabilities(ready)['feed.available']).toEqual({ state: 'ready' })
    expect(inboxFeedCapabilities({ ...ready, workspacePresent: false })['inbox.available']).toEqual({ state: 'pending', reason: 'missing-entity' })
  })
})
