/**
 * W1-07 (#1504) — the global create menu («+» on the right action rail and
 * ⌘N in the shell; UI-SPEC §3.2), fed by the `global.create` slot.
 *
 * W1-07 seeds the entries of §3.2 in their order. Each entry of a module that
 * is not built yet carries that module's flag, so it stays hidden until the
 * flag is on; wave-2 packages **replace** an entry by registering the same id
 * (slot dedupe = last wins) or add new ones — no shell edit.
 *
 * The menu only replaces the rail's plain «+» (new session) while at least one
 * visible entry is flagged or is not a W1-07 baseline seed (`showMenu`: a
 * wave-2 / plugin entry, or a seed id overridden by another source), so with
 * every flag OFF and no extra registrations the rail is byte-identical to the
 * baseline.
 */
import type { Disposable } from '@rox/core/platform'
import { UNIFIED_SURFACE_FLAGS, isUnifiedSurfaceId } from '../../shared/surface-routes'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import {
  addSlotRegistrySeeder,
  flagList,
  getSlotRegistry,
  isSlotContributionVisible,
  type SlotContribution,
  type SlotId,
  type SlotListContext,
  type SlotRegistry,
} from './slots'

export const GLOBAL_CREATE_SLOT: SlotId = 'global.create'

/** Handlers the host (right action rail) owns; mirrors its existing buttons. */
export type GlobalCreateHostHandler = 'newSession' | 'newTask' | 'newEvent' | 'newNote' | 'browser' | 'terminal'

export type GlobalCreateIntent =
  | { type: 'host'; handler: GlobalCreateHostHandler }
  | { type: 'route'; route: string }
  /** Domain command by name (TECH-SPEC §3.4); `fallbackRoute` while no bus is wired. */
  | { type: 'command'; name: string; input?: Readonly<Record<string, unknown>>; fallbackRoute?: string }

export interface GlobalCreateChild {
  id: string
  titleKey: string
  icon?: string
  flag?: string | readonly string[]
  intent: GlobalCreateIntent
}

export interface GlobalCreatePayload {
  /** `create` entries come first; `tools` follow the divider (§3.2 items 11–13). */
  group?: 'create' | 'tools'
  intent?: GlobalCreateIntent
  /** Submenu (e.g. «Новый документ ›»). */
  children?: readonly GlobalCreateChild[]
}

/**
 * Flags of modules that W1-07 does not own. Unregistered ids never resolve as
 * enabled, so these entries stay hidden until the owner registers its flag.
 */
export const GLOBAL_CREATE_OWNER_FLAGS = {
  meetingsVc: 'meetings.vc.v1',
  spaces: 'spaces.v1',
  identityPlaceholders: 'identity.placeholders.v1',
  drivePersonal: 'drive.personal.v1',
  docsDrive: 'docs.drive.v1',
  tablesBase: 'tables.base.v1',
  forms: 'forms.v1',
} as const

const W107 = 'shell.w1-07'

/** UI-SPEC §3.2, in order. Titles are i18n keys (`surfaces.create.*`). */
export const CORE_GLOBAL_CREATE_ITEMS: ReadonlyArray<SlotContribution<GlobalCreatePayload>> = [
  {
    id: 'core.new-session', slot: GLOBAL_CREATE_SLOT, order: 10, source: W107,
    titleKey: 'surfaces.create.newSession', icon: 'Plus',
    payload: { group: 'create', intent: { type: 'host', handler: 'newSession' } },
  },
  {
    id: 'messenger.new-message', slot: GLOBAL_CREATE_SLOT, order: 20, source: W107,
    titleKey: 'surfaces.create.newMessage', icon: 'MessageSquarePlus', flag: WORKBENCH_FLAG.modeMessengerV1,
    payload: {
      group: 'create',
      children: [
        { id: 'chat', titleKey: 'surfaces.create.newChat', icon: 'MessageCircle', intent: { type: 'command', name: 'im.create_chat', input: { type: 'dm' }, fallbackRoute: 'messenger' } },
        { id: 'group', titleKey: 'surfaces.create.newGroup', icon: 'Users', intent: { type: 'command', name: 'im.create_chat', input: { type: 'group' }, fallbackRoute: 'messenger' } },
        { id: 'channel', titleKey: 'surfaces.create.newChannel', icon: 'Hash', intent: { type: 'command', name: 'im.create_chat', input: { type: 'channel' }, fallbackRoute: 'messenger' } },
      ],
    },
  },
  {
    id: 'tasks.new-task', slot: GLOBAL_CREATE_SLOT, order: 30, source: W107,
    titleKey: 'surfaces.create.newTask', icon: 'SquareCheck',
    payload: { group: 'create', intent: { type: 'host', handler: 'newTask' } },
  },
  {
    id: 'docs.new-doc', slot: GLOBAL_CREATE_SLOT, order: 40, source: W107,
    titleKey: 'surfaces.create.newDoc', icon: 'FilePlus',
    payload: {
      group: 'create',
      intent: { type: 'host', handler: 'newNote' },
      children: [
        { id: 'doc', titleKey: 'surfaces.create.docDoc', icon: 'FileText', flag: WORKBENCH_FLAG.docsSharedV1, intent: { type: 'command', name: 'docs.create', input: { scope: 'shared' }, fallbackRoute: 'notes' } },
        { id: 'note', titleKey: 'surfaces.create.docNote', icon: 'NotebookPen', intent: { type: 'host', handler: 'newNote' } },
        { id: 'base', titleKey: 'surfaces.create.docBase', icon: 'Table', flag: GLOBAL_CREATE_OWNER_FLAGS.tablesBase, intent: { type: 'command', name: 'tables.create_base', fallbackRoute: 'notes' } },
        { id: 'form', titleKey: 'surfaces.create.docForm', icon: 'ClipboardList', flag: GLOBAL_CREATE_OWNER_FLAGS.forms, intent: { type: 'command', name: 'forms.create', fallbackRoute: 'notes' } },
        { id: 'mind-map', titleKey: 'surfaces.create.docMindMap', icon: 'Network', flag: WORKBENCH_FLAG.docsSharedV1, intent: { type: 'command', name: 'docs.create', input: { type: 'mindmap' }, fallbackRoute: 'notes' } },
        { id: 'folder', titleKey: 'surfaces.create.docFolder', icon: 'Folder', flag: GLOBAL_CREATE_OWNER_FLAGS.docsDrive, intent: { type: 'command', name: 'drive.create_folder', fallbackRoute: 'notes' } },
      ],
    },
  },
  {
    id: 'calendar.new-event', slot: GLOBAL_CREATE_SLOT, order: 50, source: W107,
    titleKey: 'surfaces.create.newEvent', icon: 'CalendarPlus',
    payload: { group: 'create', intent: { type: 'host', handler: 'newEvent' } },
  },
  {
    id: 'meetings.new-meeting', slot: GLOBAL_CREATE_SLOT, order: 60, source: W107,
    titleKey: 'surfaces.create.newMeeting', icon: 'Video', flag: GLOBAL_CREATE_OWNER_FLAGS.meetingsVc,
    payload: {
      group: 'create',
      children: [
        { id: 'start-now', titleKey: 'surfaces.create.meetingStartNow', icon: 'Video', intent: { type: 'command', name: 'meetings.start', fallbackRoute: 'meetings' } },
        { id: 'schedule', titleKey: 'surfaces.create.meetingSchedule', icon: 'CalendarClock', intent: { type: 'command', name: 'meetings.schedule', fallbackRoute: 'meetings' } },
      ],
    },
  },
  {
    id: 'goals.new-goal', slot: GLOBAL_CREATE_SLOT, order: 70, source: W107,
    titleKey: 'surfaces.create.newGoal', icon: 'Target', flag: WORKBENCH_FLAG.modeGoalsV1,
    payload: { group: 'create', intent: { type: 'command', name: 'goals.create', fallbackRoute: 'goals' } },
  },
  {
    id: 'goals.new-project', slot: GLOBAL_CREATE_SLOT, order: 80, source: W107,
    titleKey: 'surfaces.create.newProject', icon: 'FolderKanban', flag: WORKBENCH_FLAG.modeGoalsV1,
    payload: { group: 'create', intent: { type: 'command', name: 'projects.create', fallbackRoute: 'goals' } },
  },
  {
    id: 'spaces.new-space', slot: GLOBAL_CREATE_SLOT, order: 90, source: W107,
    // Its fallback route is the Goals mode root, so it also needs that flag.
    titleKey: 'surfaces.create.newSpace', icon: 'LayoutGrid', flag: [GLOBAL_CREATE_OWNER_FLAGS.spaces, WORKBENCH_FLAG.modeGoalsV1],
    payload: { group: 'create', intent: { type: 'command', name: 'spaces.create', fallbackRoute: 'goals' } },
  },
  {
    id: 'identity.new-team', slot: GLOBAL_CREATE_SLOT, order: 92, source: W107,
    // Its fallback route is the Contacts mode root, so it also needs that flag.
    titleKey: 'surfaces.create.newTeam', icon: 'UsersRound', flag: [GLOBAL_CREATE_OWNER_FLAGS.identityPlaceholders, WORKBENCH_FLAG.modeContactsV1],
    payload: { group: 'create', intent: { type: 'command', name: 'identity.create_team', fallbackRoute: 'contacts' } },
  },
  {
    id: 'drive.upload', slot: GLOBAL_CREATE_SLOT, order: 94, source: W107,
    titleKey: 'surfaces.create.uploadToDrive', icon: 'Upload', flag: GLOBAL_CREATE_OWNER_FLAGS.drivePersonal,
    payload: { group: 'create', intent: { type: 'command', name: 'drive.upload', fallbackRoute: 'notes' } },
  },
  {
    id: 'contacts.invite', slot: GLOBAL_CREATE_SLOT, order: 110, source: W107,
    titleKey: 'surfaces.create.invitePeople', icon: 'UserPlus', flag: WORKBENCH_FLAG.modeContactsV1,
    payload: { group: 'tools', intent: { type: 'command', name: 'identity.invite', fallbackRoute: 'contacts' } },
  },
  {
    id: 'core.browser', slot: GLOBAL_CREATE_SLOT, order: 120, source: W107,
    titleKey: 'surfaces.create.browser', icon: 'Globe',
    payload: { group: 'tools', intent: { type: 'host', handler: 'browser' } },
  },
  {
    id: 'core.terminal', slot: GLOBAL_CREATE_SLOT, order: 130, source: W107,
    titleKey: 'surfaces.create.terminal', icon: 'SquareTerminal',
    payload: { group: 'tools', intent: { type: 'host', handler: 'terminal' } },
  },
]

const seededRegistries = new WeakSet<SlotRegistry>()

/** Seed §3.2 into `global.create` once per registry (idempotent). */
export function registerCoreGlobalCreateItems(registry: SlotRegistry = getSlotRegistry()): void {
  if (seededRegistries.has(registry)) return
  seededRegistries.add(registry)
  for (const item of CORE_GLOBAL_CREATE_ITEMS) registry.register(item)
}

addSlotRegistrySeeder((registry) => registerCoreGlobalCreateItems(registry))

export interface GlobalCreateMenuEntry {
  id: string
  titleKey: string
  icon?: string
  intent?: GlobalCreateIntent
  /** True when this entry (or a visible child) is gated by a flag. */
  flagged: boolean
  /** True when this entry is not an untouched W1-07 baseline seed (id + source). */
  custom: boolean
  children: GlobalCreateMenuEntry[]
}

export interface GlobalCreateMenuModel {
  create: GlobalCreateMenuEntry[]
  tools: GlobalCreateMenuEntry[]
  /** Any visible entry is flag-gated. */
  hasFlaggedItems: boolean
  /**
   * The rail swaps its plain «+» for the menu: any visible entry is flagged
   * OR custom (not a W1-07 seed by id + source). False with every flag off
   * and only the seeds registered — baseline parity.
   */
  showMenu: boolean
}

/**
 * Flags an intent's target needs: a route (or command fallback route) into a
 * unified mode root only resolves while that mode's flag is on, so the entry
 * must require it too — otherwise it would navigate to «unavailable».
 */
export function intentRouteFlags(intent: GlobalCreateIntent | undefined): string[] {
  if (!intent || intent.type === 'host') return []
  const route = intent.type === 'route' ? intent.route : intent.fallbackRoute
  if (!route) return []
  const root = route.split('?')[0]!.split('/')[0]!
  return isUnifiedSurfaceId(root) ? [UNIFIED_SURFACE_FLAGS[root]] : []
}

function routeGateOpen(intent: GlobalCreateIntent | undefined, ctx: SlotListContext): boolean {
  return intentRouteFlags(intent).every((flag) => ctx.flags.has(flag))
}

const CORE_GLOBAL_CREATE_IDS: ReadonlySet<string> = new Set(CORE_GLOBAL_CREATE_ITEMS.map((item) => item.id))

/** A W1-07 baseline seed: one of its ids, still registered by W1-07 itself. */
export function isBaselineGlobalCreateSeed(item: Pick<SlotContribution, 'id' | 'source'>): boolean {
  return item.source === W107 && CORE_GLOBAL_CREATE_IDS.has(item.id)
}

function hasFlag(flag: SlotContribution['flag']): boolean {
  return flagList(flag).length > 0
}

/** Pure: visible menu (slot order; hidden children dropped; empty parents dropped). */
export function buildGlobalCreateMenu(
  ctx: SlotListContext,
  registry: SlotRegistry = getSlotRegistry(),
): GlobalCreateMenuModel {
  const create: GlobalCreateMenuEntry[] = []
  const tools: GlobalCreateMenuEntry[] = []
  for (const item of registry.list<GlobalCreatePayload>(GLOBAL_CREATE_SLOT, ctx)) {
    if (!item.titleKey) continue
    const children: GlobalCreateMenuEntry[] = []
    for (const child of item.payload?.children ?? []) {
      const probe: SlotContribution = { id: child.id, slot: GLOBAL_CREATE_SLOT, source: item.source, flag: child.flag }
      if (!isSlotContributionVisible(probe, ctx)) continue
      if (!routeGateOpen(child.intent, ctx)) continue
      children.push({ id: `${item.id}/${child.id}`, titleKey: child.titleKey, icon: child.icon, intent: child.intent, flagged: hasFlag(child.flag) || intentRouteFlags(child.intent).length > 0, custom: !isBaselineGlobalCreateSeed(item), children: [] })
    }
    // An own intent whose target mode is off is dropped (children may remain).
    const ownIntent = item.payload?.intent
    const intent = ownIntent && routeGateOpen(ownIntent, ctx) ? ownIntent : undefined
    if (!intent && children.length === 0) continue
    const entry: GlobalCreateMenuEntry = {
      id: item.id,
      titleKey: item.titleKey,
      icon: item.icon,
      intent,
      flagged: hasFlag(item.flag) || intentRouteFlags(intent).length > 0 || children.some((child) => child.flagged),
      custom: !isBaselineGlobalCreateSeed(item),
      // A submenu with only the parent's own action collapses to a plain item.
      children: children.length > 1 || (children.length === 1 && !intent) ? children : [],
    }
    ;(item.payload?.group === 'tools' ? tools : create).push(entry)
  }
  const visible = [...create, ...tools]
  const hasFlaggedItems = visible.some((entry) => entry.flagged)
  return { create, tools, hasFlaggedItems, showMenu: hasFlaggedItems || visible.some((entry) => entry.custom) }
}

// --- intent execution -------------------------------------------------------

export type GlobalCreateCommandDispatcher = (name: string, input?: Readonly<Record<string, unknown>>) => Promise<unknown>

// STUB(#1500): the domain command bus client plugs in here; until then a
// command intent falls back to its `fallbackRoute`. One adapter, one line to swap.
let commandDispatcher: GlobalCreateCommandDispatcher | null = null

export function setGlobalCreateCommandDispatcher(dispatcher: GlobalCreateCommandDispatcher | null): void {
  commandDispatcher = dispatcher
}

export interface GlobalCreateRunDeps {
  navigate: (route: string) => void
  host: Partial<Record<GlobalCreateHostHandler, () => void>>
}

/** Execute an intent; returns false when nothing could handle it. */
export function runGlobalCreateIntent(intent: GlobalCreateIntent, deps: GlobalCreateRunDeps): boolean {
  if (intent.type === 'host') {
    const handler = deps.host[intent.handler]
    if (!handler) return false
    handler()
    return true
  }
  if (intent.type === 'route') {
    deps.navigate(intent.route)
    return true
  }
  if (commandDispatcher) {
    void commandDispatcher(intent.name, intent.input).catch((error) => {
      console.warn('[global-create] command failed', intent.name, error)
    })
    return true
  }
  if (intent.fallbackRoute) {
    deps.navigate(intent.fallbackRoute)
    return true
  }
  return false
}

/** Disposable helper for wave-2 packages: register several entries at once. */
export function registerGlobalCreateItems(
  items: ReadonlyArray<Omit<SlotContribution<GlobalCreatePayload>, 'slot'>>,
  registry: SlotRegistry = getSlotRegistry(),
): Disposable {
  const handles = items.map((item) => registry.register({ ...item, slot: GLOBAL_CREATE_SLOT }))
  return { dispose: () => handles.forEach((handle) => handle.dispose()) }
}
