/**
 * W1-07 (#1504) — Omnibox (⌘K) provider contract for entities (UI-SPEC §3.4).
 *
 * One provider (`entities`) plugs into the existing resource registry
 * (`omnibox-bootstrap.ts`); no second palette. Domain packages register an
 * `EntitySearchSource` per kind group; each source carries its module's flag
 * and contributes nothing while that flag is off. With no sources (W1-07
 * ships none) the provider returns `[]`, so ⌘K is identical to the baseline.
 *
 * Rows are `ResourceItem { kind: 'entity' }` with `data.ref` = `kind:id`
 * (#1499 reference grammar) and `route` = `entityRoute(ref)`.
 */
import type { Disposable, ResourceItem, ResourceProvider, ResourceSearchContext } from '@rox/core/platform'
import { entityRoute, formatEntityRef, type EntityKind, type EntityRef } from '@rox/core/entities'

export const ENTITY_OMNIBOX_PROVIDER_ID = 'entities'
/** Results per group before «Show all in Advanced search ⌘⇧F». */
export const OMNIBOX_ENTITY_GROUP_LIMIT = 5

export interface EntitySearchHit {
  ref: EntityRef
  title: string
  /** Container breadcrumb, e.g. «Space › Project». */
  container?: string
  /** i18n key of a status chip (StatusBadge), if any. */
  statusKey?: string
  icon?: string
  score?: number
}

export interface EntitySearchQuery {
  query: string
  /** Kinds the active chip asks for; null = all. */
  kinds: readonly EntityKind[] | null
  limit: number
  signal?: AbortSignal
}

export interface EntitySearchSource {
  /** `<module>.<name>`, unique. */
  id: string
  /** Kinds this source can return (chip filtering skips non-matching sources). */
  kinds: readonly EntityKind[]
  /** Workbench flag id(s); all must be on. Omitted = always on. */
  flag?: string | readonly string[]
  search(query: EntitySearchQuery): Promise<EntitySearchHit[]>
}

/** Chip row of §3.4 (order matters). `kinds: null` = All. */
export const OMNIBOX_ENTITY_CHIPS: ReadonlyArray<{ id: string; titleKey: string; kinds: readonly EntityKind[] | null }> = [
  { id: 'all', titleKey: 'surfaces.omnibox.chip.all', kinds: null },
  { id: 'messages', titleKey: 'surfaces.omnibox.chip.messages', kinds: ['channel', 'channel-message'] },
  { id: 'docs', titleKey: 'surfaces.omnibox.chip.docs', kinds: ['note', 'page', 'wiki-space'] },
  { id: 'tasks', titleKey: 'surfaces.omnibox.chip.tasks', kinds: ['task', 'task-list'] },
  { id: 'goals', titleKey: 'surfaces.omnibox.chip.goals', kinds: ['goal'] },
  { id: 'projects', titleKey: 'surfaces.omnibox.chip.projects', kinds: ['project'] },
  { id: 'milestones', titleKey: 'surfaces.omnibox.chip.milestones', kinds: ['milestone'] },
  { id: 'check-ins', titleKey: 'surfaces.omnibox.chip.checkIns', kinds: ['check-in'] },
  { id: 'spaces', titleKey: 'surfaces.omnibox.chip.spaces', kinds: ['space'] },
  { id: 'people', titleKey: 'surfaces.omnibox.chip.people', kinds: ['person', 'department'] },
  { id: 'calendar', titleKey: 'surfaces.omnibox.chip.calendar', kinds: ['calendar-event', 'call'] },
  { id: 'files', titleKey: 'surfaces.omnibox.chip.files', kinds: ['file', 'folder'] },
  { id: 'bases', titleKey: 'surfaces.omnibox.chip.bases', kinds: ['base', 'base-record', 'form'] },
  { id: 'mail', titleKey: 'surfaces.omnibox.chip.mail', kinds: ['mail-thread'] },
  { id: 'sessions', titleKey: 'surfaces.omnibox.chip.sessions', kinds: ['session'] },
]

export const OMNIBOX_ENTITY_PLACEHOLDER_KEY = 'surfaces.omnibox.placeholder'
export const OMNIBOX_ENTITY_SHOW_ALL_KEY = 'surfaces.omnibox.showAll'
export const OMNIBOX_ENTITY_MORE_KEY = 'surfaces.omnibox.chip.more'

export interface EntitySourceRegistry {
  register(source: EntitySearchSource): Disposable
  list(): EntitySearchSource[]
}

export function createEntitySourceRegistry(): EntitySourceRegistry {
  const sources = new Map<string, EntitySearchSource>()
  return {
    register(source) {
      if (!source.id) throw new Error('EntitySearchSource needs an id')
      if (sources.has(source.id)) throw new Error(`EntitySearchSource already registered: ${source.id}`)
      sources.set(source.id, source)
      return {
        dispose: () => {
          if (sources.get(source.id) === source) sources.delete(source.id)
        },
      }
    },
    list: () => [...sources.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

let defaultRegistry: EntitySourceRegistry | null = null

export function getEntitySourceRegistry(): EntitySourceRegistry {
  if (!defaultRegistry) defaultRegistry = createEntitySourceRegistry()
  return defaultRegistry
}

/** Wave-2 entry point: `registerEntitySearchSource({ id: 'goals.search', kinds: ['goal'], flag, search })`. */
export function registerEntitySearchSource(source: EntitySearchSource): Disposable {
  return getEntitySourceRegistry().register(source)
}

export function __resetEntitySourcesForTests(): void {
  defaultRegistry = null
}

function sourceEnabled(source: EntitySearchSource, flags: ReadonlySet<string>): boolean {
  if (source.flag === undefined) return true
  const list = typeof source.flag === 'string' ? [source.flag] : source.flag
  return list.every((flag) => flags.has(flag))
}

export function toEntityResourceItem(hit: EntitySearchHit, sourceId: string): ResourceItem {
  const ref = formatEntityRef(hit.ref)
  return {
    id: `entity:${ref}`,
    kind: 'entity',
    title: hit.title,
    subtitle: hit.container,
    icon: hit.icon,
    route: entityRoute(hit.ref),
    data: { ref, entityKind: hit.ref.kind, source: sourceId, statusKey: hit.statusKey },
    score: hit.score,
  }
}

export interface EntityOmniboxProviderOptions {
  registry?: EntitySourceRegistry
  /** Live enabled workbench flags (renderer: `enabledShellFlagsAtom`). */
  getFlags: () => ReadonlySet<string>
  /** Active chip kinds; null = All. */
  getKinds?: () => readonly EntityKind[] | null
  label?: string
}

export function createEntityOmniboxProvider(options: EntityOmniboxProviderOptions): ResourceProvider {
  const registry = options.registry ?? getEntitySourceRegistry()
  return {
    id: ENTITY_OMNIBOX_PROVIDER_ID,
    label: options.label ?? 'Entities',
    prefixes: ['', '@'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const query = ctx.query.trim()
      if (!query) return []
      const flags = options.getFlags()
      const kinds = options.getKinds?.() ?? null
      const limit = ctx.limit ?? OMNIBOX_ENTITY_GROUP_LIMIT
      const sources = registry
        .list()
        .filter((source) => sourceEnabled(source, flags))
        .filter((source) => kinds === null || source.kinds.some((kind) => kinds.includes(kind)))
      if (sources.length === 0) return []
      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          const hits = await source.search({ query, kinds, limit, signal: ctx.signal })
          return hits
            .filter((hit) => kinds === null || kinds.includes(hit.ref.kind))
            .slice(0, limit)
            .flatMap((hit) => {
              // A malformed ref (empty id, unknown kind) drops that row only.
              try {
                return [toEntityResourceItem(hit, source.id)]
              } catch {
                return []
              }
            })
        }),
      )
      const items: ResourceItem[] = []
      const seen = new Set<string>()
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue
        for (const item of result.value) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
      }
      return items
    },
  }
}
