/**
 * W1-08 (#1505) — deterministic fixtures for entity UI stories and tests.
 * Fixture data only; nothing here talks to a live service.
 */
import type { EntityLink, EntityRef, PreviewModel, RestrictedPreview } from '@rox/core/entities'

export const FIXTURE_TASK_REF: EntityRef = { kind: 'task', id: '42' }
export const FIXTURE_SECRET_REF: EntityRef = { kind: 'project', id: 'secret-7' }
export const FIXTURE_SECRET_TITLE = 'Project Nightingale (confidential)'

export const FIXTURE_TASK_PREVIEW: PreviewModel = {
  ref: FIXTURE_TASK_REF,
  title: 'Подготовить релиз 2.4',
  icon: 'circle-check',
  status: 'ok',
  kindLabel: 'Task',
  restricted: false,
  badges: [
    { id: 'status', label: 'В работе', tone: 'info' },
    { id: 'priority', label: 'P1', tone: 'warning' },
  ],
  fields: [
    { id: 'due', label: 'Срок', value: '12.10.2026' },
    { id: 'project', label: 'Проект', value: 'Rox Desktop' },
  ],
  people: [
    { ref: { kind: 'person', id: 'p1' }, name: 'Анна Смирнова' },
    { ref: { kind: 'person', id: 'p2' }, name: 'Mark Lindgreen' },
  ],
  progress: { done: 3, total: 5 },
  etag: 'fixture-1',
}

export const FIXTURE_RESTRICTED: RestrictedPreview = {
  ref: FIXTURE_SECRET_REF,
  kind: 'project',
  status: 'no_access',
  kindLabel: 'Project',
  icon: 'folder-kanban',
  title: '',
  restricted: true,
}

export const FIXTURE_TOMBSTONE: RestrictedPreview = {
  ref: { kind: 'note', id: 'old' },
  kind: 'note',
  status: 'tombstone',
  kindLabel: 'Note',
  icon: 'file-text',
  title: '',
  restricted: true,
}

export const FIXTURE_UNAVAILABLE: RestrictedPreview = {
  ref: { kind: 'goal', id: 'g9' },
  kind: 'goal',
  status: 'unavailable',
  kindLabel: 'Goal',
  icon: 'target',
  title: '',
  restricted: true,
}

function link(id: string, from: EntityRef, relation: EntityLink['relation']): EntityLink {
  return {
    linkId: id,
    from,
    to: FIXTURE_TASK_REF,
    relation,
    createdBy: 'fixture',
    createdAt: '2026-10-01T09:00:00.000Z',
    revision: 1,
  }
}

export const FIXTURE_BACKLINKS: EntityLink[] = [
  link('l1', { kind: 'note', id: 'release-notes' }, 'mentions'),
  link('l2', { kind: 'note', id: 'release-notes' }, 'embeds'),
  link('l3', { kind: 'task', id: '41' }, 'blocks'),
  link('l4', { kind: 'session', id: 's-1' }, 'mentions'),
  link('l5', { kind: 'goal', id: 'q4' }, 'aligned-to'),
  link('l6', { kind: 'calendar-event', id: 'standup' }, 'mentions'),
  link('l7', FIXTURE_SECRET_REF, 'mentions'),
]
