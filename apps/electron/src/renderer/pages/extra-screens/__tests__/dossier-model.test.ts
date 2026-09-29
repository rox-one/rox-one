import { describe, test, expect } from 'bun:test'
import {
  buildBriefPrompt,
  buildDossierSummary,
  filterEntities,
  initials,
  normalizeDossierData,
  suggestContacts,
  type DossierEntity,
  type DossierSources,
} from '../dossier/dossier-model'

const NOW = Date.UTC(2026, 8, 29, 12)
const DAY = 86400000

function entity(partial: Partial<DossierEntity> = {}): DossierEntity {
  return {
    id: 'e1',
    name: 'Анна Королёва',
    kind: 'person',
    org: 'Конация',
    aliases: ['Анна К.', 'anna@konation'],
    notes: '',
    promises: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const sources: DossierSources = {
  sessions: [
    { id: 's1', name: 'Созвон с Анна К. про интеграцию', lastMessageAt: NOW - DAY, hasUnread: true, messenger: 'whatsapp' },
    { id: 's2', name: 'Рефакторинг', lastMessageAt: NOW },
  ],
  meetings: [
    { id: 'm1', title: 'Синк — анна королева', at: NOW - 3 * DAY },
    { id: 'm2', title: 'Ретро', at: NOW - 2 * DAY },
  ],
  tasks: [
    { id: 't1', title: 'Отправить спецификацию', notes: 'для anna@konation', open: true, dueAt: NOW + DAY },
    { id: 't2', title: 'Старое для Анна К.', open: false, createdAt: NOW - 60 * DAY },
  ],
  notes: [{ id: 'n1', title: 'Конация — условия', updatedAt: NOW - 5 * DAY }],
  feed: null,
}

describe('dossier model', () => {
  test('aggregates touches across sources by name and aliases (ё-insensitive)', () => {
    const summary = buildDossierSummary(entity(), sources, NOW)
    const ids = summary.touches.map((touch) => touch.id)
    expect(ids).toContain('s1')
    expect(ids).not.toContain('s2')
    expect(ids).toContain('m1') // «королева» matches «Королёва» (ё/case-insensitive)
    expect(ids).toContain('t1')
    expect(ids).toContain('t2')
    expect(ids).toContain('n1')
    expect(summary.touches.find((touch) => touch.id === 's1')?.kind).toBe('messenger')
    expect(summary.openTasks.map((task) => task.id)).toEqual(['t1'])
    expect(summary.unreadSessions.map((session) => session.id)).toEqual(['s1'])
    expect(summary.feedAvailable).toBe(false)
  })

  test('touches are sorted newest first; 30-day count ignores old touches', () => {
    const summary = buildDossierSummary(entity(), sources, NOW)
    const dates = summary.touches.map((touch) => touch.at ?? 0)
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
    expect(summary.touches30d).toBe(4) // s1, m1, t1, n1 (t2 is 60 days old)
  })

  test('entity without matches has no touches (honest empty state)', () => {
    const summary = buildDossierSummary(entity({ name: 'Никто Нигде', aliases: [] }), { ...sources, notes: [] }, NOW)
    expect(summary.touches).toEqual([])
    expect(summary.lastTouchAt).toBeNull()
  })

  test('promises split by direction and done state', () => {
    const e = entity({
      promises: [
        { id: 'p1', text: 'демо', direction: 'mine', done: false, createdAt: 1 },
        { id: 'p2', text: 'поля CRM', direction: 'theirs', done: false, createdAt: 2 },
        { id: 'p3', text: 'перенос', direction: 'mine', done: true, createdAt: 3 },
      ],
    })
    const summary = buildDossierSummary(e, sources, NOW)
    expect(summary.promisesMine.map((p) => p.id)).toEqual(['p1'])
    expect(summary.promisesTheirs.map((p) => p.id)).toEqual(['p2'])
    expect(summary.promisesDone.map((p) => p.id)).toEqual(['p3'])
  })

  test('normalize drops invalid rows and keeps valid ones', () => {
    expect(normalizeDossierData(undefined)).toEqual({ entities: [] })
    expect(normalizeDossierData({ entities: [null, { id: 'x' }, { id: 'a', name: ' A ', promises: [{ text: '' }, { text: 'ok', direction: 'theirs' }] }] })).toEqual({
      entities: [{
        id: 'a',
        name: 'A',
        kind: 'person',
        org: undefined,
        aliases: [],
        notes: '',
        promises: [{ id: 'p-2-0', text: 'ok', direction: 'theirs', done: false, createdAt: 0 }],
        briefSessionId: undefined,
        createdAt: 0,
        updatedAt: 0,
      }],
    })
  })

  test('filter by query and kind', () => {
    const list = [entity(), entity({ id: 'e2', name: 'Тинькофф', kind: 'company', aliases: [], org: undefined })]
    expect(filterEntities(list, 'конац', 'all').map((e) => e.id)).toEqual(['e1'])
    expect(filterEntities(list, '', 'company').map((e) => e.id)).toEqual(['e2'])
  })

  test('messenger suggestions skip known entities and duplicates', () => {
    const out = suggestContacts(
      [
        { channelName: 'Анна К.', platform: 'telegram', sessionId: 's1' },
        { channelName: '@d_volkov', platform: 'telegram', sessionId: 's2' },
        { channelName: '@d_volkov', platform: 'telegram', sessionId: 's3' },
        { platform: 'whatsapp', sessionId: 's4' },
      ],
      [entity()],
    )
    expect(out).toEqual([{ name: '@d_volkov', platform: 'telegram', sessionId: 's2' }])
  })

  test('brief prompt forbids sending and carries context', () => {
    const e = entity({ promises: [{ id: 'p1', text: 'демо-доступ', direction: 'mine', done: false, createdAt: 1 }] })
    const prompt = buildBriefPrompt(e, buildDossierSummary(e, sources, NOW), 'ru')
    expect(prompt).toContain('Ничего никому не отправляй')
    expect(prompt).toContain('я обещал: демо-доступ')
    expect(prompt).toContain('Отправить спецификацию')
  })

  test('initials', () => {
    expect(initials('Анна Королёва')).toBe('АК')
    expect(initials('@d_volkov')).toBe('D_')
    expect(initials('')).toBe('?')
  })
})
