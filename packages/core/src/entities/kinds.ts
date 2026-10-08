/**
 * W1-01 — Kind registry.
 *
 * The canonical 54-kind `EntityKind` registry for the unified Lark + Operately
 * programme. It is strictly additive over the frozen Rox2 subset:
 *
 * - `ROX2_ENTITY_KINDS` (21 kinds, `../rox2/platform-contract.ts`) stays byte
 *   identical and is re-exported here so consumers get one registry surface.
 * - 33 new kinds are appended; the v2 pass adds `invitation`.
 *
 * The route builder lives in `./routes.ts`; descriptors reference it so a
 * single source of truth produces `rox://` addresses for every kind.
 */

import { entityRoute } from './routes.ts'
import {
  ROX2_ENTITY_KINDS,
  formatRox2EntityId,
  parseRox2EntityId,
  type Rox2EntityKind,
} from '../rox2/platform-contract.ts'
import type { EntityRef } from './refs.ts'

export { ROX2_ENTITY_KINDS, formatRox2EntityId, parseRox2EntityId }
export type { Rox2EntityKind }

/**
 * 33 kinds added on top of the frozen Rox2 subset. 32 ship in v1; `invitation`
 * lands with the v2 directory pass (keep the order stable — snapshot tested).
 */
export const NEW_ENTITY_KINDS = [
  'goal',
  'goal-target',
  'goal-check',
  'check-in',
  'review',
  'okr-cycle',
  'milestone',
  'space',
  'kpi',
  'kpi-entry',
  'task-list',
  'task-section',
  'task-list-group',
  'folder',
  'drive-link',
  'wiki-space',
  'comment',
  'base',
  'base-table',
  'base-view',
  'base-record',
  'form',
  'calendar',
  'room',
  'department',
  'app',
  'project-template',
  'decision',
  'feed-item',
  'workflow-run',
  'radar-topic',
  'agent-team',
  'invitation',
] as const

export type NewEntityKind = (typeof NEW_ENTITY_KINDS)[number]

/** Full 54-kind registry: 21 frozen Rox2 kinds + 33 new kinds. */
export const ENTITY_KINDS = [...ROX2_ENTITY_KINDS, ...NEW_ENTITY_KINDS] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

/** Owner module id for a kind descriptor (DATA-MODEL §4 "Owner module"). */
export type ModuleId =
  | 'sessions'
  | 'docs'
  | 'tasks'
  | 'projects'
  | 'pages'
  | 'memory'
  | 'skills'
  | 'sources'
  | 'automations'
  | 'connections'
  | 'drive'
  | 'mail'
  | 'calendar'
  | 'contacts'
  | 'messenger'
  | 'meetings'
  | 'workflows'
  | 'goals'
  | 'spaces'
  | 'kpis'
  | 'wiki'
  | 'social'
  | 'tables'
  | 'workplace'
  | 'decisions'
  | 'feed'
  | 'radar'
  | 'agent-teams'
  | 'licences'
  | 'identity'

/** Possible authorities for a kind: local store, workspace, or an external system. */
export type Authority = 'local' | 'workspace' | 'external'

/** Omnibox / search grouping category. */
export type SearchCategory =
  | 'sessions'
  | 'docs'
  | 'tasks'
  | 'projects'
  | 'pages'
  | 'memory'
  | 'skills'
  | 'sources'
  | 'automations'
  | 'files'
  | 'messages'
  | 'calendar'
  | 'contacts'
  | 'chats'
  | 'meetings'
  | 'people'
  | 'goals'
  | 'spaces'
  | 'tables'
  | 'forms'
  | 'org'
  | 'apps'
  | 'decisions'
  | 'feed'
  | 'workflows'
  | 'radar'

/**
 * Icon identifiers. Renderers map these names onto their icon set (lucide).
 * Typed as a union so a descriptor cannot reference an unknown icon.
 */
export const ENTITY_ICON_NAMES = [
  'app-window',
  'bell',
  'book-open',
  'boxes',
  'brain',
  'building-2',
  'calendar',
  'calendar-days',
  'calendar-range',
  'circle-check',
  'clipboard-check',
  'copy',
  'door-open',
  'file-input',
  'file-text',
  'flag',
  'folder',
  'folder-kanban',
  'gauge',
  'gavel',
  'git-branch',
  'key-round',
  'layers',
  'layout-grid',
  'layout-panel-left',
  'link',
  'link-2',
  'list',
  'list-checks',
  'list-tree',
  'mail',
  'mail-plus',
  'message-circle',
  'message-square',
  'message-square-quote',
  'messages-square',
  'network',
  'newspaper',
  'paperclip',
  'play-circle',
  'plug',
  'radar',
  'repeat',
  'rows-3',
  'sparkles',
  'table',
  'table-2',
  'target',
  'trending-up',
  'user',
  'users-round',
  'video',
  'zap',
] as const

export type IconName = (typeof ENTITY_ICON_NAMES)[number]

/** Per-kind capability flags (what any surface may offer for the kind). */
export interface KindCapabilities {
  comment: boolean
  react: boolean
  subscribe: boolean
  share: boolean
  embed: boolean
  createFromChat: boolean
}

/**
 * Kind descriptor. `route` returns the app route (no `rox://` scheme); wrap
 * with `entityDeepLink` for the deep-link form.
 */
export interface KindDescriptor {
  kind: EntityKind
  owner: ModuleId
  authorities: Authority[]
  route(ref: EntityRef): string
  icon: IconName
  labelKey: string
  capabilities: KindCapabilities
  searchCategory?: SearchCategory
}

function caps(overrides: Partial<KindCapabilities> = {}): KindCapabilities {
  return {
    comment: true,
    react: true,
    subscribe: true,
    share: true,
    embed: true,
    createFromChat: true,
    ...overrides,
  }
}

/** Shared, commentable, but not embeddable inline. */
const SHARED = caps()
/** Collaborative content with inline embeds (docs, boards, goals). */
const CONTENT = caps()
/** Local-only artefacts: no comments/reactions/subscriptions/shares. */
const LOCAL = caps({ comment: false, react: false, subscribe: false, share: false, embed: false, createFromChat: false })
/** Local-only but mentionable/embeddable from chat. */
const LOCAL_EMBEDDABLE = caps({ comment: false, react: false, subscribe: false, share: false, embed: true, createFromChat: false })
/** Containers (spaces, lists, folders): everything except inline embed. */
const CONTAINER = caps({ embed: false })

export const ENTITY_KIND_DESCRIPTORS: Record<EntityKind, KindDescriptor> = {
  // --- frozen Rox2 subset (21) -------------------------------------------------
  session: {
    kind: 'session', owner: 'sessions', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'message-square', labelKey: 'entities.kind.session',
    capabilities: caps({ comment: false, react: false, embed: false }), searchCategory: 'sessions',
  },
  note: {
    kind: 'note', owner: 'docs', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'file-text', labelKey: 'entities.kind.note', capabilities: CONTENT, searchCategory: 'docs',
  },
  task: {
    kind: 'task', owner: 'tasks', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'circle-check', labelKey: 'entities.kind.task', capabilities: SHARED, searchCategory: 'tasks',
  },
  project: {
    kind: 'project', owner: 'projects', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'folder-kanban', labelKey: 'entities.kind.project', capabilities: SHARED, searchCategory: 'projects',
  },
  page: {
    kind: 'page', owner: 'pages', authorities: ['local'], route: entityRoute,
    icon: 'layout-panel-left', labelKey: 'entities.kind.page', capabilities: LOCAL, searchCategory: 'pages',
  },
  memory: {
    kind: 'memory', owner: 'memory', authorities: ['local'], route: entityRoute,
    icon: 'brain', labelKey: 'entities.kind.memory', capabilities: LOCAL, searchCategory: 'memory',
  },
  skill: {
    kind: 'skill', owner: 'skills', authorities: ['local'], route: entityRoute,
    icon: 'sparkles', labelKey: 'entities.kind.skill', capabilities: LOCAL, searchCategory: 'skills',
  },
  source: {
    kind: 'source', owner: 'sources', authorities: ['local'], route: entityRoute,
    icon: 'plug', labelKey: 'entities.kind.source', capabilities: LOCAL, searchCategory: 'sources',
  },
  automation: {
    kind: 'automation', owner: 'automations', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'zap', labelKey: 'entities.kind.automation', capabilities: LOCAL, searchCategory: 'automations',
  },
  connection: {
    kind: 'connection', owner: 'connections', authorities: ['local'], route: entityRoute,
    icon: 'link', labelKey: 'entities.kind.connection', capabilities: LOCAL,
  },
  file: {
    kind: 'file', owner: 'drive', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'paperclip', labelKey: 'entities.kind.file', capabilities: SHARED, searchCategory: 'files',
  },
  'mail-thread': {
    kind: 'mail-thread', owner: 'mail', authorities: ['external'], route: entityRoute,
    icon: 'mail', labelKey: 'entities.kind.mail-thread', capabilities: SHARED, searchCategory: 'messages',
  },
  'calendar-event': {
    kind: 'calendar-event', owner: 'calendar', authorities: ['workspace', 'external'], route: entityRoute,
    icon: 'calendar-days', labelKey: 'entities.kind.calendar-event', capabilities: SHARED, searchCategory: 'calendar',
  },
  'crm-company': {
    kind: 'crm-company', owner: 'contacts', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'building-2', labelKey: 'entities.kind.crm-company', capabilities: SHARED, searchCategory: 'contacts',
  },
  channel: {
    kind: 'channel', owner: 'messenger', authorities: ['workspace', 'external'], route: entityRoute,
    icon: 'messages-square', labelKey: 'entities.kind.channel', capabilities: SHARED, searchCategory: 'chats',
  },
  'channel-message': {
    kind: 'channel-message', owner: 'messenger', authorities: ['workspace'], route: entityRoute,
    icon: 'message-circle', labelKey: 'entities.kind.channel-message',
    capabilities: caps({ comment: false, embed: false }), searchCategory: 'messages',
  },
  call: {
    kind: 'call', owner: 'meetings', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'video', labelKey: 'entities.kind.call', capabilities: SHARED, searchCategory: 'meetings',
  },
  reminder: {
    kind: 'reminder', owner: 'calendar', authorities: ['local'], route: entityRoute,
    icon: 'bell', labelKey: 'entities.kind.reminder', capabilities: LOCAL, searchCategory: 'calendar',
  },
  workflow: {
    kind: 'workflow', owner: 'workflows', authorities: ['local'], route: entityRoute,
    icon: 'git-branch', labelKey: 'entities.kind.workflow', capabilities: LOCAL,
  },
  person: {
    kind: 'person', owner: 'contacts', authorities: ['workspace', 'local'], route: entityRoute,
    icon: 'user', labelKey: 'entities.kind.person', capabilities: SHARED, searchCategory: 'people',
  },
  'license-component': {
    kind: 'license-component', owner: 'licences', authorities: ['workspace'], route: entityRoute,
    icon: 'key-round', labelKey: 'entities.kind.license-component', capabilities: LOCAL,
  },

  // --- new v1 kinds (32) -------------------------------------------------------
  goal: {
    kind: 'goal', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'target', labelKey: 'entities.kind.goal', capabilities: CONTENT, searchCategory: 'goals',
  },
  'goal-target': {
    kind: 'goal-target', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'target', labelKey: 'entities.kind.goal-target', capabilities: SHARED, searchCategory: 'goals',
  },
  'goal-check': {
    kind: 'goal-check', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'list-checks', labelKey: 'entities.kind.goal-check', capabilities: SHARED, searchCategory: 'goals',
  },
  'check-in': {
    kind: 'check-in', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'clipboard-check', labelKey: 'entities.kind.check-in', capabilities: SHARED, searchCategory: 'goals',
  },
  review: {
    kind: 'review', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'repeat', labelKey: 'entities.kind.review', capabilities: SHARED, searchCategory: 'goals',
  },
  'okr-cycle': {
    kind: 'okr-cycle', owner: 'goals', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'calendar-range', labelKey: 'entities.kind.okr-cycle', capabilities: SHARED, searchCategory: 'goals',
  },
  milestone: {
    kind: 'milestone', owner: 'projects', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'flag', labelKey: 'entities.kind.milestone', capabilities: SHARED, searchCategory: 'projects',
  },
  space: {
    kind: 'space', owner: 'spaces', authorities: ['workspace'], route: entityRoute,
    icon: 'boxes', labelKey: 'entities.kind.space', capabilities: CONTAINER, searchCategory: 'spaces',
  },
  kpi: {
    kind: 'kpi', owner: 'kpis', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'gauge', labelKey: 'entities.kind.kpi', capabilities: SHARED, searchCategory: 'goals',
  },
  'kpi-entry': {
    kind: 'kpi-entry', owner: 'kpis', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'trending-up', labelKey: 'entities.kind.kpi-entry', capabilities: SHARED, searchCategory: 'goals',
  },
  'task-list': {
    kind: 'task-list', owner: 'tasks', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'list', labelKey: 'entities.kind.task-list', capabilities: CONTAINER, searchCategory: 'tasks',
  },
  'task-section': {
    kind: 'task-section', owner: 'tasks', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'list-tree', labelKey: 'entities.kind.task-section', capabilities: CONTAINER, searchCategory: 'tasks',
  },
  'task-list-group': {
    kind: 'task-list-group', owner: 'tasks', authorities: ['local', 'workspace'], route: entityRoute,
    icon: 'layers', labelKey: 'entities.kind.task-list-group', capabilities: CONTAINER, searchCategory: 'tasks',
  },
  folder: {
    kind: 'folder', owner: 'drive', authorities: ['workspace', 'local'], route: entityRoute,
    icon: 'folder', labelKey: 'entities.kind.folder', capabilities: CONTAINER, searchCategory: 'files',
  },
  'drive-link': {
    kind: 'drive-link', owner: 'drive', authorities: ['workspace'], route: entityRoute,
    icon: 'link-2', labelKey: 'entities.kind.drive-link', capabilities: SHARED, searchCategory: 'files',
  },
  'wiki-space': {
    kind: 'wiki-space', owner: 'wiki', authorities: ['workspace'], route: entityRoute,
    icon: 'book-open', labelKey: 'entities.kind.wiki-space', capabilities: CONTAINER, searchCategory: 'docs',
  },
  comment: {
    kind: 'comment', owner: 'social', authorities: ['workspace'], route: entityRoute,
    icon: 'message-square-quote', labelKey: 'entities.kind.comment', capabilities: caps({ embed: false }),
  },
  base: {
    kind: 'base', owner: 'tables', authorities: ['workspace'], route: entityRoute,
    icon: 'table-2', labelKey: 'entities.kind.base', capabilities: CONTENT, searchCategory: 'tables',
  },
  'base-table': {
    kind: 'base-table', owner: 'tables', authorities: ['workspace'], route: entityRoute,
    icon: 'table', labelKey: 'entities.kind.base-table', capabilities: CONTENT, searchCategory: 'tables',
  },
  'base-view': {
    kind: 'base-view', owner: 'tables', authorities: ['workspace'], route: entityRoute,
    icon: 'layout-grid', labelKey: 'entities.kind.base-view', capabilities: SHARED, searchCategory: 'tables',
  },
  'base-record': {
    kind: 'base-record', owner: 'tables', authorities: ['workspace'], route: entityRoute,
    icon: 'rows-3', labelKey: 'entities.kind.base-record', capabilities: SHARED, searchCategory: 'tables',
  },
  form: {
    kind: 'form', owner: 'tables', authorities: ['workspace'], route: entityRoute,
    icon: 'file-input', labelKey: 'entities.kind.form', capabilities: SHARED, searchCategory: 'forms',
  },
  calendar: {
    kind: 'calendar', owner: 'calendar', authorities: ['workspace', 'external'], route: entityRoute,
    icon: 'calendar', labelKey: 'entities.kind.calendar', capabilities: CONTAINER, searchCategory: 'calendar',
  },
  room: {
    kind: 'room', owner: 'calendar', authorities: ['workspace'], route: entityRoute,
    icon: 'door-open', labelKey: 'entities.kind.room', capabilities: SHARED, searchCategory: 'calendar',
  },
  department: {
    kind: 'department', owner: 'contacts', authorities: ['workspace'], route: entityRoute,
    icon: 'network', labelKey: 'entities.kind.department', capabilities: CONTAINER, searchCategory: 'org',
  },
  app: {
    kind: 'app', owner: 'workplace', authorities: ['workspace', 'local'], route: entityRoute,
    icon: 'app-window', labelKey: 'entities.kind.app', capabilities: SHARED, searchCategory: 'apps',
  },
  'project-template': {
    kind: 'project-template', owner: 'projects', authorities: ['workspace'], route: entityRoute,
    icon: 'copy', labelKey: 'entities.kind.project-template', capabilities: SHARED, searchCategory: 'projects',
  },
  decision: {
    kind: 'decision', owner: 'decisions', authorities: ['local'], route: entityRoute,
    icon: 'gavel', labelKey: 'entities.kind.decision', capabilities: LOCAL, searchCategory: 'decisions',
  },
  'feed-item': {
    kind: 'feed-item', owner: 'feed', authorities: ['local'], route: entityRoute,
    icon: 'newspaper', labelKey: 'entities.kind.feed-item', capabilities: LOCAL, searchCategory: 'feed',
  },
  'workflow-run': {
    kind: 'workflow-run', owner: 'workflows', authorities: ['local'], route: entityRoute,
    icon: 'play-circle', labelKey: 'entities.kind.workflow-run', capabilities: LOCAL_EMBEDDABLE, searchCategory: 'workflows',
  },
  'radar-topic': {
    kind: 'radar-topic', owner: 'radar', authorities: ['local'], route: entityRoute,
    icon: 'radar', labelKey: 'entities.kind.radar-topic', capabilities: LOCAL, searchCategory: 'radar',
  },
  'agent-team': {
    kind: 'agent-team', owner: 'agent-teams', authorities: ['local'], route: entityRoute,
    icon: 'users-round', labelKey: 'entities.kind.agent-team', capabilities: LOCAL,
  },

  // --- v2 kinds (1) ------------------------------------------------------------
  invitation: {
    kind: 'invitation', owner: 'identity', authorities: ['workspace'], route: entityRoute,
    icon: 'mail-plus', labelKey: 'entities.kind.invitation', capabilities: LOCAL, searchCategory: 'contacts',
  },
}

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value)
}

export function kindDescriptor(kind: EntityKind): KindDescriptor {
  return ENTITY_KIND_DESCRIPTORS[kind]
}