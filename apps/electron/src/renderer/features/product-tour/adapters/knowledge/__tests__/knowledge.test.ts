import { expect, test } from 'bun:test'
import type { Lesson } from '@rox/shared/memory/types'
import type { NativeDataReceipt, NoteDocument } from '@rox/shared/protocol/dto'
import type { PageRenderLease } from '@rox/shared/pages/types'
import { createSearchFence, deriveKnowledgeSignals, knowledgeCapabilities, matchesMemoryReadback, matchesNoteReceipt, notesReadCapability, openCurrentSearchResult, pageLeaseMatches } from '../index'

const observation = { binding: { clientProfileId: 'profile', workspaceId: 'workspace', panelId: 'panel', runToken: 'run' }, operationToken: 'operation', at: 10 }
const note = { id: 'note', nativeId: 'native-note', nativeRevision: 3, content: 'private draft' } as NoteDocument
const receipt: NativeDataReceipt = { workspaceId: 'workspace', kind: 'notes', nativeId: 'native-note', operationId: 'native-operation', revision: 3, sequence: 8, contentHash: 'digest', deleted: false, issuer: 'issuer', subject: 'subject' }
const lesson: Lesson = { rule: 'private rule', scope: 'workspace', ts: '2026-10-03T00:00:00Z', category: 'workflow', source: { trigger: 'explicit' }, owner: { issuer: 'issuer', subject: 'subject' } }

test('T-NOTES-SAVE: only the exact native receipt completes a save, never queue acknowledgement alone', () => {
  expect(matchesNoteReceipt(receipt, { workspaceId: 'workspace', nativeId: note.nativeId!, operationId: 'native-operation', expectedRevision: 2 })).toBe(true)
  for (const change of [{ workspaceId: 'foreign' }, { nativeId: 'foreign' }, { operationId: 'foreign' }, { revision: 2 }, { deleted: true }, { kind: 'tasks' }]) {
    expect(matchesNoteReceipt({ ...receipt, ...change }, { workspaceId: 'workspace', nativeId: note.nativeId!, operationId: 'native-operation', expectedRevision: 2 })).toBe(false)
  }
  expect(deriveKnowledgeSignals(observation, { kind: 'note-saved', workspaceId: 'workspace', note, receipt: null, operationId: 'native-operation', expectedRevision: 2 }, 20)).toEqual([])
})

test('T-NOTES-CREATE: current native read-back is required and normalized signals never contain private text', () => {
  const completion = { kind: 'note-created' as const, workspaceId: 'workspace', note, readback: note }
  const [signal] = deriveKnowledgeSignals(observation, completion, 20)
  expect(signal?.name).toBe('note.created')
  expect(signal?.level).toBe('verified')
  expect(signal?.operationStartedAt).toBe(10)
  expect(JSON.stringify(signal)).not.toContain('private draft')
  expect(deriveKnowledgeSignals(observation, { ...completion, readback: { ...note, nativeId: 'foreign' } }, 20)).toEqual([])
  expect(deriveKnowledgeSignals(observation, { ...completion, workspaceId: 'foreign' }, 20)).toEqual([])
})

test('T-MEMORY-SAVE / T-MEMORY-SCOPE: a matching rule from a different scope or owner is not persistence', () => {
  expect(matchesMemoryReadback(lesson, [lesson], 'workspace')).toBe(true)
  expect(matchesMemoryReadback(lesson, [{ ...lesson, scope: 'global' }], 'workspace')).toBe(false)
  expect(matchesMemoryReadback(lesson, [{ ...lesson, owner: { issuer: 'issuer', subject: 'foreign' } }], 'workspace')).toBe(false)
  expect(matchesMemoryReadback({ ...lesson, scope: 'global' }, [lesson], 'global')).toBe(false)
  expect(deriveKnowledgeSignals(observation, { kind: 'memory-saved', workspaceId: 'workspace', scope: 'workspace', lesson, readback: [] }, 20)).toEqual([])
  expect(deriveKnowledgeSignals(observation, { kind: 'memory-saved', workspaceId: 'workspace', scope: 'workspace', lesson, readback: [lesson] }, 20)[0]?.name).toBe('memory.persisted')
})

test('T-SEARCH-QUERY / T-SEARCH-OPEN: query/workspace generations fence stale responses, including A to B to A', () => {
  const fence = createSearchFence()
  const first = fence.begin('workspace', 'alpha')
  fence.begin('workspace', 'beta')
  const current = fence.begin('workspace', 'alpha')
  expect(fence.current(first)).toBe(false)
  expect(fence.current(current)).toBe(true)
  fence.begin('other', 'alpha')
  expect(fence.current(current)).toBe(false)
  const final = fence.begin('workspace', 'alpha')
  fence.invalidate()
  expect(fence.current(final)).toBe(false)
})

test('T-PAGES-OPEN / T-PAGES-STATE: host evidence requires the current, unexpired exact digest lease', () => {
  const lease: PageRenderLease = { leaseId: 'lease', nonce: 'secret', pageSlug: 'page', contentDigest: 'digest', issuedAt: 1, expiresAt: 100 }
  expect(pageLeaseMatches(lease, 'page', 'digest', 20)).toBe(true)
  expect(pageLeaseMatches(lease, 'page', 'new-digest', 20)).toBe(false)
  expect(pageLeaseMatches(lease, 'other', 'digest', 20)).toBe(false)
  expect(pageLeaseMatches(lease, 'page', 'digest', 100)).toBe(false)
  const [signal] = deriveKnowledgeSignals(observation, { kind: 'page-host-rendered', workspaceId: 'workspace', pageSlug: 'page', contentDigest: 'digest', lease }, 20)
  expect(signal?.name).toBe('page.rendered')
  expect(signal?.level).toBe('observed')
  expect(JSON.stringify(signal)).not.toContain('secret')
})

test('unavailable knowledge APIs and failed reads never advertise ready', () => {
  expect(knowledgeCapabilities({ notes: 'unavailable', memory: 'unavailable', memoryWrite: 'denied', pages: 'pending', pagePresent: false, search: 'unavailable' })).toMatchObject({
    'notes.available': { state: 'unavailable', reason: 'api-unavailable' },
    'memory.write-available': { state: 'denied', reason: 'not-authorized' },
    'pages.entity-present': { state: 'pending', reason: 'missing-entity' },
  })
})

test('asset inventory denial is an accessory state and cannot disable native Notes authority', () => {
  expect(notesReadCapability(null, { code: 'AUTH_FAILED' })).toEqual({ state: 'ready' })
  expect(notesReadCapability({ code: 'AUTH_FAILED' }, null)).toEqual({ state: 'denied', reason: 'not-authorized' })
})

test('T-SEARCH-OPEN: stale or failed native freshness reads never navigate; current native hit owns the destination', async () => {
  const results = Promise.withResolvers<Array<{ id: string; path: string }>>()
  let current = true
  const opened: string[] = []
  const old = openCurrentSearchResult({ read: () => results.promise, current: () => current, matches: item => item.id === 'id', open: item => { opened.push(item.path) } })
  current = false
  results.resolve([{ id: 'id', path: 'stale destination' }])
  expect(await old).toBe(false)
  expect(opened).toEqual([])
  expect(await openCurrentSearchResult({ read: async () => { throw new Error('denied') }, current: () => true, matches: () => true, open: () => { opened.push('failed') } })).toBe(false)
  expect(await openCurrentSearchResult({ read: async () => [{ id: 'id', path: 'current destination' }], current: () => true, matches: item => item.id === 'id', open: item => { opened.push(item.path) } })).toBe(true)
  expect(opened).toEqual(['current destination'])
  expect(await openCurrentSearchResult({ read: async () => [], current: () => true, matches: () => true, open: () => { opened.push('deleted') } })).toBe(false)
})
