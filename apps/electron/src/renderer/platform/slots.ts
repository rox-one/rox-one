/**
 * W1-07 (#1504) — the shell **slot registry** (PLAN §1.1 mechanism #3).
 *
 * Modules contribute UI to other surfaces by slot id instead of importing
 * each other: tabs, sidebar sections, header buttons, composer menu items,
 * slash commands, quick panels, global-create entries and surface pages.
 * Example: `goal.page.tabs` receives «Документы и файлы» from DOC-2 and
 * «Задачи» from TSK-1.
 *
 * Contract (frozen with `contracts-v1`):
 * - Slot ids are an open template `<surface>.<slot>[.<sub>…]` (lowercase,
 *   dot-separated). Known ids are documented in `SLOT_CATALOGUE`; ids that
 *   other wave-1 packages build on are listed in `RESERVED_SLOT_PATTERNS`, so
 *   W1-15 (#1512) and W1-08 (#1505) register without editing this file.
 * - Contributions are keyed by `(slot, id)`. Registering the same key again
 *   **replaces** the earlier contribution (dedupe, last wins — wave-2 packages
 *   replace W1-07 placeholders and HMR re-registers cleanly). Disposing a
 *   replaced handle is a no-op.
 * - `list()` is deterministic: `order` ascending (default 1000), then id.
 * - A contribution is listed only when **every** flag in `flag` is enabled and
 *   its `when` expression holds (`evaluateWhen` from `@rox/core/platform`).
 *   With every flag off nothing flagged is listed, so the shell is unchanged.
 *
 * Pure TS: no React, no jotai. Hooks live in `useSlots.ts`.
 */
import { evaluateWhen, type ContextKeys, type Disposable } from '@rox/core/platform'

/** Open template: wave-2 packages may introduce new `<surface>.<slot>` ids. */
export type SlotId = `${string}.${string}`

export type SlotKind =
  | 'page'
  | 'tabs'
  | 'sidebar-section'
  | 'header-button'
  | 'composer-menu'
  | 'slash-command'
  | 'quick-panel'
  | 'global-create'
  | 'context-menu'
  | 'chrome'
  | 'agent-context'

export interface SlotContribution<P = unknown> {
  /** Unique within the slot, `<module>.<name>` (e.g. `docs.files-tab`). */
  id: string
  slot: SlotId
  /** Ascending; step 10 leaves room for inserts. Default 1000. */
  order?: number
  /** i18n key for the visible label (never a literal string). */
  titleKey?: string
  /** Lucide icon name; the host maps it to a component. */
  icon?: string
  /** Workbench flag id(s); all must be enabled for the entry to show. */
  flag?: string | readonly string[]
  /** Context-keys `when` expression; omitted = always. */
  when?: string
  /** Contributing module / package (diagnostics, ownership). */
  source: string
  /** Slot-specific payload (component, command name, panel kind, …). */
  payload?: P
}

export interface SlotListContext {
  /** Enabled workbench flag ids (renderer: `enabledShellFlagsAtom`). */
  flags: ReadonlySet<string>
  /** Context keys for `when` expressions. */
  keys?: ContextKeys
}

export interface SlotRegistry {
  register<P>(contribution: SlotContribution<P>): Disposable
  /** Visible contributions of one slot, sorted (`order`, then id). */
  list<P = unknown>(slot: SlotId, ctx: SlotListContext): SlotContribution<P>[]
  /** Every registered contribution of a slot, ignoring flags/when (tests, diagnostics). */
  all<P = unknown>(slot: SlotId): SlotContribution<P>[]
  get<P = unknown>(slot: SlotId, id: string): SlotContribution<P> | undefined
  /** Slot ids that currently have at least one contribution. */
  slots(): SlotId[]
  onDidChange(listener: () => void): Disposable
}

export const DEFAULT_SLOT_ORDER = 1000

// ---------------------------------------------------------------------------
// Slot id grammar + catalogue
// ---------------------------------------------------------------------------

const SLOT_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && SLOT_ID_PATTERN.test(value)
}

/** Rail surfaces that own slots (Docs = the Notes mode). */
export const SHELL_SURFACES = [
  'home',
  'chat',
  'messenger',
  'meetings',
  'calendar',
  'tasks',
  'goals',
  'docs',
  'contacts',
  'feed',
  'inbox',
] as const

export type ShellSurface = (typeof SHELL_SURFACES)[number]

export interface SlotDescriptor {
  kind: SlotKind
  /** Who renders the slot (the host); contributors are anyone. */
  host: string
}

function perSurface(suffix: string, kind: SlotKind): Array<[SlotId, SlotDescriptor]> {
  return SHELL_SURFACES.map((surface) => [`${surface}.${suffix}` as SlotId, { kind, host: surface }])
}

/**
 * Documented slot ids (UI-SPEC §3, §5, §8, §26; TECH-SPEC §19). Not a
 * whitelist: any well-formed id may be registered into.
 */
export const SLOT_CATALOGUE: Readonly<Record<string, SlotDescriptor>> = Object.fromEntries([
  ['global.create', { kind: 'global-create', host: 'shell' }],
  // Surface pages of the unified modes (empty state until wave 2 registers).
  ['messenger.page', { kind: 'page', host: 'shell' }],
  ['calendar.page', { kind: 'page', host: 'shell' }],
  ['goals.page', { kind: 'page', host: 'shell' }],
  ['contacts.page', { kind: 'page', host: 'shell' }],
  // Every rail surface: top-bar tabs, sidebar sections, header buttons.
  ...perSurface('tabs', 'tabs'),
  ...perSurface('sidebar', 'sidebar-section'),
  ...perSurface('header.buttons', 'header-button'),
  // Composers, slash menus, quick panels.
  ['chat.composer.menu', { kind: 'composer-menu', host: 'chat' }],
  ['chat.slash', { kind: 'slash-command', host: 'chat' }],
  ['messenger.composer.menu', { kind: 'composer-menu', host: 'messenger' }],
  ['messenger.slash', { kind: 'slash-command', host: 'messenger' }],
  ['messenger.quick-panels', { kind: 'quick-panel', host: 'messenger' }],
  ['messenger.chat.tabs', { kind: 'tabs', host: 'messenger' }],
  ['docs.slash', { kind: 'slash-command', host: 'docs' }],
  // Entity pages (Operately tabs with count chips).
  ['goal.page.tabs', { kind: 'tabs', host: 'goals' }],
  ['project.page.tabs', { kind: 'tabs', host: 'goals' }],
  ['space.page.tabs', { kind: 'tabs', host: 'goals' }],
  ['contacts.profile.tabs', { kind: 'tabs', host: 'contacts' }],
  ['task.detail.sections', { kind: 'sidebar-section', host: 'tasks' }],
] satisfies Array<[SlotId, SlotDescriptor]>)

/**
 * Ids reserved for sibling wave-1 packages. They may be registered into
 * freely; the reservation only documents ownership.
 * - `entity.row.context` — W1-08 (#1505): common row context menu items.
 * - `<surface>.chrome`, `<surface>.sidebar.<section>` — W1-15 (#1512): surface
 *   chrome schemas (TECH-SPEC §19).
 * - `agent.context.<surface>` — W1-15 (#1512): agent-panel context providers
 *   (TECH-SPEC §18.1).
 */
export const RESERVED_SLOT_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: SlotKind; owner: string; example: SlotId }> = [
  { pattern: /^entity\.row\.context$/, kind: 'context-menu', owner: '#1505', example: 'entity.row.context' },
  { pattern: /^[a-z][a-z0-9-]*\.chrome$/, kind: 'chrome', owner: '#1512', example: 'messenger.chrome' },
  { pattern: /^[a-z][a-z0-9-]*\.sidebar\.[a-z0-9][a-z0-9-]*$/, kind: 'sidebar-section', owner: '#1512', example: 'docs.sidebar.drive' },
  { pattern: /^agent\.context\.[a-z][a-z0-9-]*$/, kind: 'agent-context', owner: '#1512', example: 'agent.context.docs' },
]

/** Reserved owner (`#1505`, `#1512`) of a slot id, or null. */
export function reservedSlotOwner(slot: string): string | null {
  return RESERVED_SLOT_PATTERNS.find((entry) => entry.pattern.test(slot))?.owner ?? null
}

/** Kind of a slot: catalogue first, then reserved patterns, then the suffix. */
export function slotKind(slot: SlotId): SlotKind | null {
  const known = SLOT_CATALOGUE[slot]
  if (known) return known.kind
  const reserved = RESERVED_SLOT_PATTERNS.find((entry) => entry.pattern.test(slot))
  if (reserved) return reserved.kind
  if (slot.endsWith('.tabs')) return 'tabs'
  if (slot.endsWith('.slash')) return 'slash-command'
  if (slot.endsWith('.page')) return 'page'
  return null
}

// ---------------------------------------------------------------------------
// Ordering + visibility (pure)
// ---------------------------------------------------------------------------

export function compareSlotContributions(a: SlotContribution, b: SlotContribution): number {
  const orderA = a.order ?? DEFAULT_SLOT_ORDER
  const orderB = b.order ?? DEFAULT_SLOT_ORDER
  if (orderA !== orderB) return orderA - orderB
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/** A contribution's `flag` as a list (none → []). */
export function flagList(flag: SlotContribution['flag']): readonly string[] {
  if (flag === undefined) return []
  return typeof flag === 'string' ? [flag] : flag
}

/** True when every flag is enabled and `when` holds. */
export function isSlotContributionVisible(contribution: SlotContribution, ctx: SlotListContext): boolean {
  if (!flagList(contribution.flag).every((flag) => ctx.flags.has(flag))) return false
  return evaluateWhen(contribution.when, ctx.keys ?? {})
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class SlotRegistryImpl implements SlotRegistry {
  private readonly bySlot = new Map<SlotId, Map<string, SlotContribution>>()
  private readonly listeners = new Set<() => void>()

  register<P>(contribution: SlotContribution<P>): Disposable {
    if (!isSlotId(contribution.slot)) {
      throw new Error(`Invalid slot id: ${String(contribution.slot)}`)
    }
    if (!contribution.id || typeof contribution.id !== 'string') {
      throw new Error(`Slot contribution in ${contribution.slot} needs an id`)
    }
    let entries = this.bySlot.get(contribution.slot)
    if (!entries) {
      entries = new Map()
      this.bySlot.set(contribution.slot, entries)
    }
    const stored = { ...contribution } as SlotContribution
    entries.set(contribution.id, stored)
    this.notify()
    return {
      dispose: () => {
        const current = this.bySlot.get(contribution.slot)
        // Only remove the exact registration this handle created.
        if (current?.get(contribution.id) !== stored) return
        current.delete(contribution.id)
        if (current.size === 0) this.bySlot.delete(contribution.slot)
        this.notify()
      },
    }
  }

  list<P = unknown>(slot: SlotId, ctx: SlotListContext): SlotContribution<P>[] {
    return this.all<P>(slot).filter((contribution) => isSlotContributionVisible(contribution, ctx))
  }

  all<P = unknown>(slot: SlotId): SlotContribution<P>[] {
    const entries = this.bySlot.get(slot)
    if (!entries) return []
    return ([...entries.values()] as SlotContribution<P>[]).sort(compareSlotContributions)
  }

  get<P = unknown>(slot: SlotId, id: string): SlotContribution<P> | undefined {
    return this.bySlot.get(slot)?.get(id) as SlotContribution<P> | undefined
  }

  slots(): SlotId[] {
    return [...this.bySlot.keys()].sort()
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

export function createSlotRegistry(): SlotRegistry {
  return new SlotRegistryImpl()
}

let registry: SlotRegistry | null = null
const seeders: Array<(registry: SlotRegistry) => void> = []

/** The shell's singleton slot registry (W1-15 and wave 2 register here). */
export function getSlotRegistry(): SlotRegistry {
  if (!registry) {
    registry = createSlotRegistry()
    // Seed before anyone can subscribe, so seeding never notifies mid-render.
    for (const seed of seeders) seed(registry)
  }
  return registry
}

/**
 * Shell-owned default contributions (e.g. the §3.2 create entries). Runs on
 * the singleton now if it exists, and on every fresh singleton (test resets).
 */
export function addSlotRegistrySeeder(seed: (registry: SlotRegistry) => void): void {
  seeders.push(seed)
  if (registry) seed(registry)
}

export function __resetSlotRegistryForTests(): void {
  registry = null
}
