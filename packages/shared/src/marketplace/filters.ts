import type { MarketplaceEntry, MarketplaceEntryKind } from './catalog.ts'
import type { MarketplaceEntryStats } from './stats.ts'

export type MarketplaceKindFilter = MarketplaceEntryKind | 'service' | 'rule' | ''
export type MarketplaceSortKey = 'stars' | 'downloads' | 'updated' | 'name'

export interface MarketplaceFilterOptions {
  query?: string
  kind?: MarketplaceKindFilter
  tags?: readonly string[]
  installedOnly?: boolean
  installedIds?: ReadonlySet<string>
  groupIds?: ReadonlySet<string>
  sort?: MarketplaceSortKey
  stats?: Readonly<Record<string, MarketplaceEntryStats>>
  locale?: string
}

function matchesKind(entry: MarketplaceEntry, kind: MarketplaceKindFilter): boolean {
  if (!kind) return true
  if (kind === 'service') {
    if (entry.kind !== 'tool') return false
    return (entry.tags ?? []).some((tag) =>
      ['service', 'services', 'hosting', 'api', 'saas', 'cloud'].includes(tag.toLocaleLowerCase()),
    )
  }
  if (kind === 'rule') return entry.kind === 'context-doc'
  return entry.kind === kind
}

/** Apply marketplace search and intersecting facets, then sort deterministically. */
export function filterMarketplaceEntries(
  entries: readonly MarketplaceEntry[],
  options: MarketplaceFilterOptions = {},
): MarketplaceEntry[] {
  const query = options.query?.trim().toLocaleLowerCase(options.locale) ?? ''
  const tags = options.tags ?? []
  const filtered = entries.filter((entry) => {
    if (query && !`${entry.title}\n${entry.descriptionRu}`.toLocaleLowerCase(options.locale).includes(query)) return false
    if (!matchesKind(entry, options.kind ?? '')) return false
    if (tags.some((tag) => !(entry.tags ?? []).includes(tag))) return false
    if (options.installedOnly && !options.installedIds?.has(entry.id)) return false
    if (options.groupIds && !options.groupIds.has(entry.id)) return false
    return true
  })
  const stats = options.stats ?? {}
  const totalDownloads = (id: string) =>
    (stats[id]?.npmWeeklyDownloads ?? 0) + (stats[id]?.githubReleaseDownloads ?? 0)
  const numberUpdated = (id: string) => {
    const value = stats[id]?.pushedAt
    return value ? new Date(value).getTime() || 0 : 0
  }
  const sort = options.sort ?? 'stars'
  return filtered.sort((a, b) => {
    let order = 0
    if (sort === 'name') order = a.title.localeCompare(b.title, options.locale)
    else if (sort === 'downloads') order = totalDownloads(b.id) - totalDownloads(a.id)
    else if (sort === 'updated') order = numberUpdated(b.id) - numberUpdated(a.id)
    else order = (stats[b.id]?.stars ?? 0) - (stats[a.id]?.stars ?? 0)
    return order || a.title.localeCompare(b.title, options.locale) || a.id.localeCompare(b.id)
  })
}
