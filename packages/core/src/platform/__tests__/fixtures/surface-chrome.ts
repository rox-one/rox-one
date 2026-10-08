/**
 * W1-15 (#1512) — reference surface chrome for the schema lint: one
 * `SurfaceChromeContribution` per surface of UI-SPEC §26.2 (left sidebar) and
 * §26.3 (top bar).
 *
 * This is the *reference* chrome, not shipped UI: CHR (#1533) and the wave-2
 * surface packages register their own schemas into `<surface>.chrome`, and the
 * lint (`lintChromeCatalogue`) checks them against the same rules. Keeping one
 * complete example in the repo proves the contract can express every surface
 * without an exception.
 *
 * Every `titleKey` here exists in all 12 locales (asserted by the client test),
 * so the fixture cannot hide a typo behind "test-only" keys.
 */
import type { EntityKind } from '../../../entities/kinds.ts'
import {
  buildRowContextMenu,
  type MenuItemSpec,
  type SidebarSchema,
  type SidebarSection,
  type SurfaceChromeContribution,
  type TopBarLeftZoneItem,
  type TopBarSchema,
} from '../../chrome.ts'

/** Rail-surface titles reuse the mode registry's keys. */
const MODE = {
  home: 'workbench.mode.home',
  chat: 'workbench.mode.chat',
  messenger: 'workbench.mode.messenger',
  docs: 'workbench.mode.docs',
  tasks: 'workbench.mode.tasks',
  calendar: 'workbench.mode.calendar',
  meetings: 'workbench.mode.meetings',
  goals: 'workbench.mode.goals',
  contacts: 'workbench.mode.contacts',
  feed: 'workbench.mode.feed',
  inbox: 'workbench.mode.inbox',
} as const

const section = (
  id: string,
  rows: SidebarSection['rows'],
  options: Partial<Omit<SidebarSection, 'id' | 'rows'>> = {},
): SidebarSection => ({ id, rows, collapsible: rows === 'provider', titleKey: `chrome.section.${id}`, ...options })

const sidebar = (
  surface: string,
  defaultWidth: SidebarSchema['defaultWidth'],
  titleKey: string,
  create: SidebarSchema['header']['create'],
  sections: SidebarSchema['sections'],
  options: Partial<Pick<SidebarSchema, 'pinned' | 'footer' | 'contextMenu'>> = {},
): SidebarSchema => ({
  surface,
  defaultWidth,
  header: create ? { titleKey, create } : { titleKey },
  pinned: options.pinned ?? false,
  sections,
  footer: options.footer ?? null,
  contextMenu: options.contextMenu ?? { extra: [] },
})

const topBar = (
  surface: string,
  left: TopBarLeftZoneItem[],
  center: TopBarSchema['center'],
  right: TopBarSchema['right'],
): TopBarSchema => ({ surface, left, center, right })

const rowMenu = (...extra: MenuItemSpec[]): { extra: MenuItemSpec[] } => ({ extra })
const moveToMenu: MenuItemSpec = { id: 'tasks.row.move', titleKey: 'chrome.rowContext.openSplit' }

/** §26.2 header-create menus (a subset of the global create menu, §3.2). */
const CREATE = {
  home: { default: 'tasks.create', menu: ['docs.create_document', 'calendar.create_event', 'im.create_chat', 'vc.start_meeting', 'goals.create'] },
  chat: { default: 'app.newChat', menu: ['app.newChatInPanel'] },
  messenger: { default: 'im.create_chat', menu: ['im.create_chat', 'im.create_chat', 'im.set_visibility'] },
  docs: { default: 'docs.create_document', menu: ['docs.create_document', 'docs.create_document', 'drive.upload_file', 'drive.create_folder'] },
  wiki: { default: 'wiki.create_space', menu: ['wiki.create_space'] },
  drive: { default: 'drive.upload_file', menu: ['drive.create_folder', 'drive.upload_file', 'docs.create_document'] },
  base: { default: 'tables.insert_row', menu: ['tables.insert_row', 'drive.upload_file'] },
  forms: { default: 'forms.configure_on_submit', menu: ['forms.configure_on_submit'] },
  tasks: { default: 'tasks.create', menu: ['task_lists.create', 'task_sections.create'] },
  calendar: { default: 'calendar.create_event', menu: ['calendar.create_event', 'calendar.create_time_block', 'calendar.create_event'] },
  meetings: { default: 'vc.start_meeting', menu: ['calendar.create_event', 'vc.join'] },
  goals: { default: 'goals.create', menu: ['projects.create', 'kpis.create', 'spaces.create'] },
  contacts: { default: 'people.invite', menu: ['people.invite', 'contacts.create_card'] },
  feed: { default: 'drive.add_link', menu: ['drive.add_link'] },
  inbox: { default: 'mail.create_task_from_thread', menu: ['reminders.create'] },
  agentCenter: { default: 'agents.invoke', menu: ['agents.invoke'] },
} as const

const ALL_PINNED_KINDS: EntityKind[] = ['note', 'task', 'project', 'goal', 'space', 'channel', 'file', 'base', 'form']

/** UI-SPEC §26.2 — one row per left sidebar. */
export const FIXTURE_SIDEBAR_SURFACES: readonly string[] = [
  'home', 'chat', 'messenger', 'docs', 'wiki', 'drive', 'base', 'forms', 'tasks',
  'calendar', 'meetings', 'goals', 'contacts', 'feed', 'inbox', 'agent-center', 'settings', 'search',
]

const SIDEBARS: Record<string, SidebarSchema> = {
  home: sidebar('home', 240, MODE.home, CREATE.home, [
    section('pinned', 'static', { counter: { provider: 'counter.home.pinned', tone: 'volume' } }),
    section('today', 'provider', { counter: { provider: 'counter.home.today', tone: 'action' } }),
    section('recent', 'provider'),
    section('collections', 'static'),
    section('people', 'provider'),
  ], { pinned: { kinds: ALL_PINNED_KINDS }, contextMenu: rowMenu({ id: 'home.row.remove-recent', titleKey: 'chrome.rowContext.archive' }) }),
  chat: sidebar('chat', 260, MODE.chat, CREATE.chat, [
    section('pinned', 'static'),
    section('history', 'provider', { counter: { provider: 'counter.chat.history', tone: 'volume' } }),
    section('views', 'static'),
    section('filters', 'static'),
  ], { pinned: { kinds: ['session'] } }),
  messenger: sidebar('messenger', 280, MODE.messenger, CREATE.messenger, [
    section('filters', 'static'),
    section('pinned', 'static'),
    section('collections', 'provider', { counter: { provider: 'counter.messenger.collections', tone: 'action' } }),
    section('people', 'provider'),
  ], { pinned: { kinds: ['channel'] } }),
  docs: sidebar('docs', 280, MODE.docs, CREATE.docs, [
    section('filters', 'static'),
    section('pinned', 'static'),
    section('recent', 'provider', { counter: { provider: 'counter.docs.recent', tone: 'volume' } }),
    section('shared', 'provider'),
    section('collections', 'static', { drop: 'docs.move_note_to_shared' }),
    section('personal', 'provider'),
    section('trash', 'static'),
  ], { pinned: { kinds: ['note', 'file', 'base', 'form'] } }),
  wiki: sidebar('wiki', 280, 'chrome.surface.wiki', CREATE.wiki, [
    section('collections', 'provider', { drop: 'wiki.move_node' }),
    section('people', 'provider', { counter: { provider: 'counter.wiki.people', tone: 'action' } }),
  ]),
  drive: sidebar('drive', 280, 'chrome.surface.drive', CREATE.drive, [
    section('collections', 'provider', { drop: 'drive.move_items' }),
    section('shared', 'provider', { counter: { provider: 'counter.drive.shared', tone: 'volume' } }),
    section('recent', 'provider'),
    section('trash', 'static'),
  ], { footer: 'quota' }),
  base: sidebar('base', 260, 'chrome.surface.base', CREATE.base, [
    section('pinned', 'static'),
    section('collections', 'provider'),
    section('views', 'provider'),
    section('shared', 'provider'),
  ], { pinned: { kinds: ['base', 'base-table', 'base-view'] } }),
  forms: sidebar('forms', 260, 'chrome.surface.forms', CREATE.forms, [
    section('collections', 'provider'),
    section('templates', 'static'),
    section('shared', 'provider'),
    section('trash', 'static', { counter: { provider: 'counter.forms.trash', tone: 'volume' } }),
  ]),
  tasks: sidebar('tasks', 224, MODE.tasks, CREATE.tasks, [
    section('filters', 'static', { counter: { provider: 'counter.tasks.today', tone: 'action' } }),
    section('pinned', 'static'),
    section('lists', 'provider', { drop: 'tasks.add_to_list' }),
    section('views', 'provider'),
    section('recent', 'provider'),
  ], { pinned: { kinds: ['task', 'task-list'] }, contextMenu: rowMenu(moveToMenu) }),
  calendar: sidebar('calendar', 240, MODE.calendar, CREATE.calendar, [
    section('views', 'static', { counter: { provider: 'counter.calendar.invites', tone: 'action' } }),
    section('collections', 'provider'),
    section('filters', 'static'),
  ], { pinned: { kinds: ['calendar-event', 'calendar'] } }),
  meetings: sidebar('meetings', 260, MODE.meetings, CREATE.meetings, [
    section('today', 'provider', { counter: { provider: 'counter.meetings.now', tone: 'action' } }),
    section('upcoming', 'provider'),
    section('history', 'provider'),
    section('recordings', 'provider'),
  ]),
  goals: sidebar('goals', 240, MODE.goals, CREATE.goals, [
    section('views', 'static', { counter: { provider: 'counter.goals.review', tone: 'action' } }),
    section('pinned', 'static'),
    section('collections', 'provider', { drop: 'goals.link_work' }),
    section('lists', 'provider'),
    section('templates', 'static'),
  ], { pinned: { kinds: ['goal', 'project', 'kpi', 'space'] } }),
  contacts: sidebar('contacts', 280, MODE.contacts, CREATE.contacts, [
    section('people', 'static', { counter: { provider: 'counter.contacts.new', tone: 'action' } }),
    section('collections', 'provider'),
    section('templates', 'static'),
  ]),
  feed: sidebar('feed', 240, MODE.feed, CREATE.feed, [
    section('filters', 'static'),
    section('sources', 'provider', { drop: 'drive.add_link' }),
    section('personal', 'static'),
  ]),
  inbox: sidebar('inbox', 260, MODE.inbox, CREATE.inbox, [
    section('filters', 'static', { counter: { provider: 'counter.inbox.review', tone: 'action' } }),
    section('today', 'provider'),
    section('upcoming', 'provider'),
    section('history', 'provider'),
  ], { pinned: { kinds: ['reminder', 'mail-thread'] } }),
  'agent-center': sidebar('agent-center', 240, 'chrome.surface.agentCenter', CREATE.agentCenter, [
    section('today', 'provider', { counter: { provider: 'counter.agents.awaiting', tone: 'action' } }),
    section('views', 'static'),
    section('history', 'provider', { counter: { provider: 'counter.agents.running', tone: 'volume' } }),
  ]),
  settings: sidebar('settings', 240, 'chrome.surface.settings', undefined, [
    section('collections', 'provider'),
    section('personal', 'static'),
  ]),
  search: sidebar('search', 240, 'chrome.surface.search', undefined, [
    section('filters', 'static'),
    section('views', 'provider'),
    section('recent', 'provider', { counter: { provider: 'counter.search.recent', tone: 'volume' } }),
  ]),
}

/** UI-SPEC §26.3 — one row per top bar (page surfaces included). */
export const FIXTURE_TOPBAR_SURFACES: readonly string[] = [
  'home', 'chat', 'messenger', 'docs', 'doc', 'wiki', 'drive', 'base', 'form', 'forms', 'tasks',
  'calendar', 'meetings', 'meetings-call', 'goals', 'goal', 'project', 'space', 'contacts',
  'feed', 'inbox', 'mail', 'agent-center', 'settings', 'search',
]

const TOP_BARS: Record<string, TopBarSchema> = {
  home: topBar('home', ['title', 'status'], { kind: 'views', views: ['overview', 'apps', 'activity'] }, ['more']),
  chat: topBar('chat', ['title', 'status'], { kind: 'views', views: ['list', 'board', 'table', 'heatmap'] }, ['more']),
  messenger: topBar('messenger', ['back-forward', 'title', 'status'], { kind: 'tabs', tabs: ['chat', 'pinned', 'files', 'docs'] }, ['search', 'presence', 'more']),
  docs: topBar('docs', ['title'], { kind: 'views', views: ['home', 'recent', 'shared', 'favorites'] }, ['filter', 'sort', 'search', 'more']),
  doc: topBar('doc', ['back-forward', 'breadcrumb', 'title', 'status', 'saved-state'], null, ['search', 'presence', 'share', 'more']),
  wiki: topBar('wiki', ['back-forward', 'breadcrumb', 'title'], null, ['search', 'presence', 'share', 'more']),
  drive: topBar('drive', ['back-forward', 'breadcrumb'], { kind: 'views', views: ['list', 'grid'] }, ['filter', 'sort', 'search', 'share', 'more']),
  base: topBar('base', ['back-forward', 'breadcrumb'], { kind: 'tabs', tabs: ['grid', 'kanban', 'gallery', 'gantt', 'calendar'] }, ['filter', 'sort', 'search', 'presence', 'share', 'more']),
  form: topBar('form', ['back-forward', 'breadcrumb'], { kind: 'tabs', tabs: ['questions', 'responses', 'settings'] }, ['presence', 'share', 'more']),
  forms: topBar('forms', ['back-forward', 'breadcrumb'], { kind: 'views', views: ['mine', 'shared', 'drafts', 'closed'] }, ['filter', 'sort', 'search', 'more']),
  tasks: topBar('tasks', ['back-forward', 'breadcrumb'], { kind: 'views', views: ['list', 'board', 'gantt', 'calendar'] }, ['filter', 'sort', 'search', 'presence', 'share', 'more']),
  calendar: topBar('calendar', ['title', 'status'], { kind: 'date-nav', ranges: ['day', 'week', 'month'] }, ['search', 'more']),
  meetings: topBar('meetings', ['title'], { kind: 'views', views: ['upcoming', 'history', 'recordings'] }, ['search', { primary: 'vc.start_meeting' }, 'more']),
  'meetings-call': topBar('meetings-call', ['title', 'status'], { kind: 'views', views: ['gallery', 'speaker', 'document'] }, ['presence', 'share', 'more']),
  goals: topBar('goals', ['title'], { kind: 'views', views: ['tree', 'table', 'gantt'] }, ['filter', 'sort', 'search', 'more']),
  goal: topBar('goal', ['back-forward', 'breadcrumb', 'status'], { kind: 'tabs', tabs: ['overview', 'checkins', 'discussions', 'related', 'docs', 'tasks'] }, ['search', 'presence', 'share', { primary: 'goals.create_check_in' }, 'more']),
  project: topBar('project', ['back-forward', 'breadcrumb', 'status'], { kind: 'tabs', tabs: ['overview', 'tasks', 'milestones', 'checkins', 'discussions', 'resources', 'workspace'] }, ['search', 'presence', 'share', { primary: 'goals.create_check_in' }, 'more']),
  space: topBar('space', ['back-forward', 'breadcrumb'], { kind: 'tabs', tabs: ['overview', 'goals', 'projects', 'discussions', 'docs', 'members'] }, ['search', 'presence', 'share', 'more']),
  contacts: topBar('contacts', ['back-forward', 'breadcrumb'], { kind: 'views', views: ['table', 'cards'] }, ['filter', 'search', 'more']),
  feed: topBar('feed', ['title', 'status'], { kind: 'views', views: ['all', 'unread', 'flagged'] }, ['filter', 'search', 'more']),
  inbox: topBar('inbox', ['title', 'status'], { kind: 'views', views: ['mine', 'assignedByMe'] }, ['filter', 'search', 'more']),
  mail: topBar('mail', ['back-forward', 'breadcrumb'], null, [{ primary: 'tasks.create_from_email' }, 'more']),
  'agent-center': topBar('agent-center', ['title'], { kind: 'views', views: ['active', 'history'] }, ['filter', 'more']),
  settings: topBar('settings', ['title'], null, ['search']),
  search: topBar('search', ['title'], { kind: 'query' }, ['sort', 'more']),
}

/** One contribution per surface; a page surface reuses its section's sidebar. */
export const SURFACE_CHROME_FIXTURE: readonly SurfaceChromeContribution[] = FIXTURE_TOPBAR_SURFACES.map((surface) => {
  const own = SIDEBARS[surface]
  return {
    surface,
    ...(own ? { sidebar: own } : {}),
    topBar: TOP_BARS[surface]!,
  }
})

/** Sidebars every surface package must register, in rail order (§26.2). */
export const FIXTURE_PAGE_SURFACES_WITHOUT_SIDEBAR = FIXTURE_TOPBAR_SURFACES.filter((surface) => !SIDEBARS[surface])

/** The complete menu a row opens: the common block plus the surface extras. */
export const FIXTURE_ROW_MENU_EXAMPLE = buildRowContextMenu(rowMenu(moveToMenu).extra)