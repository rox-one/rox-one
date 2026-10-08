/**
 * W1-15 (#1512) — Surface chrome registry: the `SidebarSchema` / `TopBarSchema`
 * contract (TECH-SPEC §19, UI-SPEC §26), the counter provider contract and the
 * common row context menu.
 *
 * One rail only (UI-SPEC §26.1): sub-areas of a mode live in that mode's left
 * sidebar, never in a second icon column. The shell renders both bars from
 * these schemas, so there are no per-surface header components.
 *
 * Dependency-free like the rest of `@rox/core`: the renderer registers a
 * contribution into W1-07's slot `<surface>.chrome` (see `chromeSlot`), and
 * other packages add sections or right-zone items through the existing slot
 * ids (e.g. DOC-2 adds «Диск ▸» to `docs.sidebar`, DRV supplies the quota
 * footer).
 *
 * Flags: `workbench.chrome.surfaces.v1` gates the renderer. With it off
 * nothing here is read — the shell renders exactly as before.
 */

import type { EntityKind } from '../entities/kinds.ts'
import type { CommandType } from '../commands/envelope.ts'

/**
 * A chrome surface: a rail surface (`home`, `chat`, `messenger`, `docs`,
 * `tasks`, `calendar`, `meetings`, `goals`, `contacts`, `feed`, `inbox`, …) or
 * a page/non-rail surface that owns its own top bar (`doc`, `goal`, `project`,
 * `space`, `mail`, `agent-center`, `settings`, `search`, …). Also the value
 * type of the surface half of every chrome slot id.
 */
export type SurfaceId = string

/** A view switcher entry (UI-SPEC §26.1 center zone). Wave-2 packages name them. */
export type ViewId = string

/** A page-tab entry (Operately-style tabs with count chips). */
export type TabId = string

// ---------------------------------------------------------------------------
// Slot ids (W1-07 registers the reserved patterns for these)
// ---------------------------------------------------------------------------

/** `<surface>.chrome` — one `SurfaceChromeContribution` per surface. */
export const CHROME_SLOT_SUFFIX = '.chrome'

/** `<surface>.sidebar.<section>` — one contribution per sidebar section. */
export const SIDEBAR_SLOT_INFIX = '.sidebar.'

/** `agent.context.<surface>` — one agent-panel context provider per surface. */
export const AGENT_CONTEXT_SLOT_PREFIX = 'agent.context.'

/** Mirrors W1-07's slot grammar (`isSlotId`) so ids here validate without the renderer. */
const SLOT_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/
const SURFACE_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export function isChromeSurfaceId(value: unknown): value is SurfaceId {
  return typeof value === 'string' && value.length <= 64 && SURFACE_ID_PATTERN.test(value)
}

/** Slot id of a surface's chrome contribution: `<surface>.chrome`. */
export function chromeSlotId(surface: SurfaceId): string {
  if (!isChromeSurfaceId(surface)) throw new Error(`Invalid surface id: ${String(surface)}`)
  return `${surface}${CHROME_SLOT_SUFFIX}`
}

/** Slot id of one sidebar section: `<surface>.sidebar.<section>`. */
export function sidebarSectionSlotId(surface: SurfaceId, sectionId: string): string {
  if (!isChromeSurfaceId(surface)) throw new Error(`Invalid surface id: ${String(surface)}`)
  if (typeof sectionId !== 'string' || sectionId.length > 64 || !SECTION_ID_PATTERN.test(sectionId)) {
    throw new Error(`Invalid sidebar section id: ${String(sectionId)}`)
  }
  return `${surface}${SIDEBAR_SLOT_INFIX}${sectionId}`
}

/** Slot id of an agent-panel context provider: `agent.context.<surface>`. */
export function agentContextSlotId(surface: SurfaceId): string {
  if (!isChromeSurfaceId(surface)) throw new Error(`Invalid surface id: ${String(surface)}`)
  return `${AGENT_CONTEXT_SLOT_PREFIX}${surface}`
}

/** Slot id of a sidebar section: its own id is already the slot id (UI-SPEC §26.2). */
export function isChromeSlotId(value: unknown): boolean {
  return typeof value === 'string' && value.endsWith(CHROME_SLOT_SUFFIX) && SLOT_ID_PATTERN.test(value)
}

export function isSidebarSectionSlotId(value: unknown): boolean {
  return typeof value === 'string' && value.includes(SIDEBAR_SLOT_INFIX) && SLOT_ID_PATTERN.test(value)
}

export function isAgentContextSlotId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(AGENT_CONTEXT_SLOT_PREFIX) && SLOT_ID_PATTERN.test(value)
}

// ---------------------------------------------------------------------------
// Common row context menu (UI-SPEC §26.1)
// ---------------------------------------------------------------------------

/**
 * One menu row. `kind: 'divider'` renders a separator (then `titleKey` and
 * `command` are absent). `when` is the W1-07 `when`-language expression over
 * context keys (e.g. `pinned`), so a state-dependent pair such as
 * «Закрепить / Открепить» is two specs, not one spec with two commands.
 */
export interface MenuItemSpec {
  id: string
  /** i18n key; absent for dividers. */
  titleKey?: string
  command?: CommandType
  hotkey?: string
  when?: string
  kind?: 'item' | 'divider'
  danger?: boolean
}

/** The canonical right-zone order of the top bar (UI-SPEC §26.1). Append-only. */
export const TOPBAR_RIGHT_ZONE_ORDER = ['filter', 'sort', 'search', 'presence', 'share', 'primary', 'more'] as const

export type TopBarRightZoneItem = (typeof TOPBAR_RIGHT_ZONE_ORDER)[number]

/** The @rox button is appended by the shell; surfaces can never remove or reorder it. */
export const TOPBAR_AGENT_BUTTON_ID = '@rox'

export const TOPBAR_LEFT_ZONE_ITEMS = ['back-forward', 'breadcrumb', 'title', 'status', 'privacy', 'saved-state'] as const
export type TopBarLeftZoneItem = (typeof TOPBAR_LEFT_ZONE_ITEMS)[number]

/** Max views in a segmented switcher before the rest collapse into «Ещё ▾» (UI-SPEC §26.1). */
export const MAX_TOPBAR_VIEWS = 5

/**
 * The common row context menu every list row / card / chip / file opens
 * (UI-SPEC §26.1). Surface-specific items are appended by the surface's
 * `SidebarSchema.contextMenu.extra`.
 */
export const COMMON_ROW_CONTEXT_MENU: readonly MenuItemSpec[] = [
  { id: 'entity.row.open', titleKey: 'chrome.rowContext.open', hotkey: 'Enter' },
  { id: 'entity.row.open-new-tab', titleKey: 'chrome.rowContext.openNewTab' },
  { id: 'entity.row.open-split', titleKey: 'chrome.rowContext.openSplit', when: 'supportsSplit' },
  { id: 'entity.row.divider-1', kind: 'divider' },
  { id: 'entity.row.pin', titleKey: 'chrome.rowContext.pin', command: 'entities.pin', when: '!pinned' },
  { id: 'entity.row.unpin', titleKey: 'chrome.rowContext.unpin', command: 'entities.unpin', when: 'pinned' },
  { id: 'entity.row.copy-link', titleKey: 'chrome.rowContext.copyLink' },
  { id: 'entity.row.share-to-chat', titleKey: 'chrome.rowContext.shareToChat' },
  { id: 'entity.row.ask-rox', titleKey: 'chrome.rowContext.askRox' },
  { id: 'entity.row.remind', titleKey: 'chrome.rowContext.remind', command: 'reminders.create' },
  { id: 'entity.row.divider-2', kind: 'divider' },
  { id: 'entity.row.rename', titleKey: 'chrome.rowContext.rename' },
  { id: 'entity.row.archive', titleKey: 'chrome.rowContext.archive' },
  { id: 'entity.row.delete', titleKey: 'chrome.rowContext.delete', danger: true },
]

/**
 * Common menu + the surface's own items. A surface item whose id already
 * exists in the common menu replaces it in place (waves override a default
 * rather than rendering twice); everything else is appended after the common
 * block, before the trailing rename/archive/delete block.
 */
export function buildRowContextMenu(extra: readonly MenuItemSpec[] = []): MenuItemSpec[] {
  if (extra.length === 0) return [...COMMON_ROW_CONTEXT_MENU]
  const replacements = new Map(extra.map((item) => [item.id, item]))
  const tailStart = COMMON_ROW_CONTEXT_MENU.findIndex((item) => item.id === 'entity.row.divider-2')
  const head = COMMON_ROW_CONTEXT_MENU.slice(0, tailStart)
  const tail = COMMON_ROW_CONTEXT_MENU.slice(tailStart)
  const additions = extra.filter((item) => !COMMON_ROW_CONTEXT_MENU.some((common) => common.id === item.id))
  const rendered = head.map((item) => replacements.get(item.id) ?? item)
  return [...rendered, ...additions, ...tail]
}

// ---------------------------------------------------------------------------
// Counters (UI-SPEC §26.1 «Counters», TECH-SPEC §19 «Counters»)
// ---------------------------------------------------------------------------

export const COUNTER_TONES = ['action', 'volume'] as const

/**
 * `action` = a red filled pill: something needs my action (mentions, overdue,
 * approvals, invitations). `volume` = a grey text count: plain volume (unread
 * in muted chats, items in a list).
 */
export type CounterTone = (typeof COUNTER_TONES)[number]

/** The logical realtime topic counters are pushed on (TECH-SPEC §19). */
export const USER_COUNTERS_TOPIC = 'user.counters'

/**
 * Realtime event type for a counters push. The wire topic stays W1-03's
 * `user:<principalId>` (ACL target `self`); `user.counters` is the logical
 * topic name from TECH-SPEC §19. See `userCountersTopic()`.
 */
export const USER_COUNTERS_EVENT_TYPE = 'counters.changed'

/** Coalescing window for counter pushes (TECH-SPEC §19). */
export const USER_COUNTERS_COALESCE_MS = 1000

/** Counters above this render as «99+» and as a dot when the sidebar is collapsed. */
export const COUNTER_DISPLAY_CAP = 99

/** Counter queries are registered as `counter.<id>` by the owner module. */
export const COUNTER_QUERY_PREFIX = 'counter.'

export function counterQueryName(id: string): string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error(`Invalid counter id: ${String(id)}`)
  return `${COUNTER_QUERY_PREFIX}${id}`
}

export function isCounterQueryName(value: unknown): boolean {
  return typeof value === 'string' && /^counter\.[a-z0-9][a-z0-9.-]*$/.test(value)
}

/** The `user:` topic a principal's counters actually travel on. */
export function userCountersTopic(principalId: string): string {
  if (typeof principalId !== 'string' || principalId.length === 0) throw new Error('userCountersTopic needs a principal id')
  return `user:${principalId}`
}

export interface CounterValue {
  count: number
  /** Overrides the section's tone when the provider knows better. */
  tone?: CounterTone
}

export interface CounterComputeInput {
  workspaceId: string | null
  principalId: string
  surface: SurfaceId
  /** Section the counter belongs to (`<surface>.sidebar.<section>`). */
  sectionId?: string
}

/**
 * A counter provider is a query the owner module registers as `counter.<id>`
 * and the shell asks per sidebar section. Pure: the module supplies the rows,
 * the provider only counts what the viewer may see (ACL already applied).
 */
export interface CounterProvider {
  /** Registered query name, `counter.<id>`. */
  query: string
  tone: CounterTone
  compute(input: CounterComputeInput): CounterValue | null
}

/** «99+» above the cap; never negative. */
export function formatCounter(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  return count > COUNTER_DISPLAY_CAP ? `${COUNTER_DISPLAY_CAP}+` : String(Math.floor(count))
}

// ---------------------------------------------------------------------------
// Sidebar / top bar schemas (TECH-SPEC §19)
// ---------------------------------------------------------------------------

export const SIDEBAR_DEFAULT_WIDTHS = [220, 224, 240, 260, 280] as const
export type SidebarDefaultWidth = (typeof SIDEBAR_DEFAULT_WIDTHS)[number]

/** Resizable range (UI-SPEC §26.1 «Width»); below `SIDEBAR_SNAP_TO_COLLAPSED` a drag snaps to 56. */
export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_COLLAPSED_WIDTH = 56
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 56
export const SIDEBAR_SNAP_TO_COLLAPSED = 200

/** The collapse control «« / ⌘B (the existing `view.toggleSidebar`). */
export const SIDEBAR_TOGGLE_COMMAND: CommandType = 'view.toggleSidebar'

export const SIDEBAR_FOOTERS = ['quota', 'org', 'accounts', 'agent-status'] as const
export type SidebarFooter = (typeof SIDEBAR_FOOTERS)[number]

export interface SidebarSection {
  /** Section id; the slot id is `<surface>.sidebar.<id>`. */
  id: string
  /** i18n key for the section header; product-fixed sections still carry one. */
  titleKey?: string
  collapsible: boolean
  /** `static` = fixed product views; `provider` = a list from a module query. */
  rows: 'static' | 'provider'
  counter?: { provider: string; tone: CounterTone }
  /** X-13 drop target command for this row. */
  drop?: CommandType
}

export interface SidebarHeaderCreate {
  /**
   * `+` runs the surface default. A domain command name *or* a renderer action
   * id (`app.newChat`) — both use the same `<module>.<operation>` grammar, and
   * the surface decides which registry resolves it.
   */
  default: CommandType
  /** `▾` lists the surface's other create items (subset of the global create menu). */
  menu: CommandType[]
}

export interface SidebarSchema {
  surface: SurfaceId
  defaultWidth: SidebarDefaultWidth
  header: { titleKey: string; create?: SidebarHeaderCreate }
  /** Kinds shown in the «Закреплённое» section, or false when the surface has none. */
  pinned: { kinds: EntityKind[] } | false
  /** Ordered; ids are the slot ids `<surface>.sidebar.<section>`. */
  sections: SidebarSection[]
  footer?: SidebarFooter | null
  /** Appended to the common row context menu (`buildRowContextMenu`). */
  contextMenu: { extra: MenuItemSpec[] }
}

export type TopBarCenterControl =
  | { kind: 'views'; views: ViewId[] }
  | { kind: 'date-nav'; ranges: ReadonlyArray<'day' | 'week' | 'month'> }
  | { kind: 'tabs'; tabs: TabId[] }
  | { kind: 'query' }
  | null

export type TopBarRightItem = TopBarRightZoneItem | { primary: CommandType }

export interface TopBarSchema {
  surface: SurfaceId
  left: TopBarLeftZoneItem[]
  /** Exactly one center control per surface (UI-SPEC §26.1) — a single value, never a list. */
  center: TopBarCenterControl
  /** In `TOPBAR_RIGHT_ZONE_ORDER`; `@rox` is appended by the shell and never listed here. */
  right: TopBarRightItem[]
}

/** What a surface package registers into `<surface>.chrome`. */
export interface SurfaceChromeContribution {
  surface: SurfaceId
  sidebar?: SidebarSchema
  topBar?: TopBarSchema
}

/**
 * Structural twin of W1-07's `SlotContribution` (`renderer/platform/slots.ts`).
 * Declared locally so `@rox/core` never imports the renderer; the renderer
 * passes the returned object straight to `registry.register`.
 */
export interface ChromeSlotContributionLike {
  id: string
  slot: string
  order?: number
  titleKey?: string
  flag?: string | readonly string[]
  when?: string
  source: string
  payload: SurfaceChromeContribution
}

/** Build the W1-07 slot contribution for a surface's chrome. */
export function chromeSlot(
  contribution: SurfaceChromeContribution,
  options: { order?: number; when?: string; source?: string; flag?: string } = {},
): ChromeSlotContributionLike {
  const slot = chromeSlotId(contribution.surface)
  return {
    id: contribution.surface,
    slot,
    order: options.order ?? 1000,
    flag: options.flag ?? CHROME_SURFACES_WORKBENCH_FLAG,
    ...(options.when ? { when: options.when } : {}),
    source: options.source ?? 'chrome',
    payload: contribution,
  }
}

/** Mirrors `WORKBENCH_FLAG.workbenchChromeSurfacesV1` (kept literal: no flag import cycle). */
export const CHROME_SURFACES_WORKBENCH_FLAG = 'workbench.chrome.surfaces.v1'

// ---------------------------------------------------------------------------
// Schema lint
// ---------------------------------------------------------------------------

export interface ChromeLintIssue {
  surface: SurfaceId
  rule: string
  detail: string
}

function lintSidebar(schema: SidebarSchema, issues: ChromeLintIssue[]): void {
  const at = (rule: string, detail: string) => issues.push({ surface: schema.surface, rule, detail })
  if (!isChromeSurfaceId(schema.surface)) at('surface-id', `invalid surface id: ${schema.surface}`)
  if (!(SIDEBAR_DEFAULT_WIDTHS as readonly number[]).includes(schema.defaultWidth)) {
    at('default-width', `${schema.defaultWidth} is not a spec width`)
  }
  if (!schema.header?.titleKey?.includes('.')) at('header-title', 'header.titleKey must be an i18n key')

  const sectionIds = new Set<string>()
  for (const section of schema.sections ?? []) {
    if (sectionIds.has(section.id)) at('section-unique', `duplicate section id: ${section.id}`)
    sectionIds.add(section.id)
    const slot = sidebarSectionSlotId(schema.surface, section.id)
    if (slot !== `${schema.surface}${SIDEBAR_SLOT_INFIX}${section.id}`) at('section-slot', `bad slot id: ${slot}`)
    if (section.rows !== 'static' && section.rows !== 'provider') at('section-rows', `${section.id}: rows=${String(section.rows)}`)
    if (section.counter && !isCounterQueryName(section.counter.provider)) {
      at('section-counter', `${section.id}: ${section.counter.provider} is not a counter.<id> query`)
    }
    if (section.counter && !(COUNTER_TONES as readonly string[]).includes(section.counter.tone)) {
      at('section-counter-tone', `${section.id}: tone=${String(section.counter.tone)}`)
    }
    if (section.drop !== undefined && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(section.drop)) {
      at('section-drop', `${section.id}: ${String(section.drop)} is not a command name`)
    }
  }
  if ((schema.sections ?? []).length === 0) at('sections-empty', 'a surface sidebar has at least one section')

  if (schema.pinned !== false) {
    const kinds = schema.pinned?.kinds
    if (!Array.isArray(kinds) || kinds.length === 0) at('pinned-kinds', 'pinned is neither false nor a non-empty kind list')
  }
  if (schema.footer !== undefined && schema.footer !== null && !(SIDEBAR_FOOTERS as readonly string[]).includes(schema.footer)) {
    at('footer', `unknown footer: ${String(schema.footer)}`)
  }
  const menuIds = new Set<string>()
  for (const item of schema.contextMenu?.extra ?? []) {
    if (menuIds.has(item.id)) at('context-menu-unique', `duplicate menu id: ${item.id}`)
    menuIds.add(item.id)
    if (item.kind !== 'divider' && !item.titleKey?.includes('.')) at('context-menu-title', `${item.id} needs an i18n titleKey`)
  }
}

function lintTopBar(schema: TopBarSchema, issues: ChromeLintIssue[]): void {
  const at = (rule: string, detail: string) => issues.push({ surface: schema.surface, rule, detail })
  if (!isChromeSurfaceId(schema.surface)) at('surface-id', `invalid surface id: ${schema.surface}`)

  const left = schema.left ?? []
  if (new Set(left).size !== left.length) at('left-zone-unique', 'duplicate left-zone items')
  let leftPrevious = -1
  for (const item of left) {
    const index = (TOPBAR_LEFT_ZONE_ITEMS as readonly string[]).indexOf(item)
    if (index < 0) { at('left-zone-item', `unknown left item: ${String(item)}`); continue }
    if (index < leftPrevious) at('left-zone-order', `${item} is out of the §26.1 left order`)
    leftPrevious = index
  }

  // Exactly one center control: a single value (never a list), and a views
  // switcher holds at most MAX_TOPBAR_VIEWS before «Ещё ▾».
  const center = schema.center
  if (Array.isArray(center)) at('center-single', 'center must be one control, not a list')
  if (center) {
    if (center.kind === 'views' && (center.views.length === 0 || center.views.length > MAX_TOPBAR_VIEWS)) {
      at('center-views', `views=${center.views.length} (1…${MAX_TOPBAR_VIEWS})`)
    }
    if (center.kind === 'date-nav' && center.ranges.length === 0) at('center-date-nav', 'ranges is empty')
    if (center.kind === 'tabs' && center.tabs.length === 0) at('center-tabs', 'tabs is empty')
    if (!['views', 'date-nav', 'tabs', 'query'].includes(center.kind)) at('center-kind', `unknown kind: ${String(center.kind)}`)
  }

  // Right zone: the canonical order of §26.1, and the whole zone is at most one item per position.
  const positions = (schema.right ?? []).map((item) => (typeof item === 'string' ? item : 'primary'))
  const seen = new Set<string>()
  let previous = -1
  for (const position of positions) {
    const index = (TOPBAR_RIGHT_ZONE_ORDER as readonly string[]).indexOf(position)
    if (index < 0) { at('right-zone-item', `unknown right item: ${position}`); continue }
    if (seen.has(position)) at('right-zone-duplicate', `duplicate right item: ${position}`)
    seen.add(position)
    if (index < previous) at('right-zone-order', `${position} is out of the §26.1 order`)
    previous = index
  }
  if ((schema.right ?? []).some((item) => (item as string) === TOPBAR_AGENT_BUTTON_ID)) {
    at('right-zone-agent', '@rox is appended by the shell and must not be listed')
  }
}

/** Lint one surface chrome contribution; empty array = conforming. */
export function lintSurfaceChrome(contribution: SurfaceChromeContribution): ChromeLintIssue[] {
  const issues: ChromeLintIssue[] = []
  if (contribution.sidebar) lintSidebar(contribution.sidebar, issues)
  if (contribution.topBar) lintTopBar(contribution.topBar, issues)
  if (contribution.topBar && contribution.topBar.surface !== contribution.surface) {
    issues.push({ surface: contribution.surface, rule: 'surface-match', detail: `topBar.surface=${contribution.topBar.surface}` })
  }
  if (contribution.sidebar && contribution.sidebar.surface !== contribution.surface) {
    issues.push({ surface: contribution.surface, rule: 'surface-match', detail: `sidebar.surface=${contribution.sidebar.surface}` })
  }
  return issues
}

/**
 * Lint a whole fixture / registry: every surface must expose the bars the
 * caller expects (`requireSidebar` / `requireTopBar`), and every schema must
 * pass `lintSurfaceChrome`.
 */
export function lintChromeCatalogue(
  contributions: readonly SurfaceChromeContribution[],
  options: { requireSidebar?: readonly SurfaceId[]; requireTopBar?: readonly SurfaceId[] } = {},
): ChromeLintIssue[] {
  const issues: ChromeLintIssue[] = []
  const bySurface = new Map<SurfaceId, SurfaceChromeContribution>()
  for (const contribution of contributions) {
    if (bySurface.has(contribution.surface)) {
      issues.push({ surface: contribution.surface, rule: 'surface-unique', detail: 'duplicate chrome contribution' })
      continue
    }
    bySurface.set(contribution.surface, contribution)
    issues.push(...lintSurfaceChrome(contribution))
  }
  for (const surface of options.requireSidebar ?? []) {
    if (!bySurface.get(surface)?.sidebar) issues.push({ surface, rule: 'sidebar-missing', detail: 'surface has no SidebarSchema' })
  }
  for (const surface of options.requireTopBar ?? []) {
    if (!bySurface.get(surface)?.topBar) issues.push({ surface, rule: 'topbar-missing', detail: 'surface has no TopBarSchema' })
  }
  return issues
}