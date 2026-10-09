/**
 * «Библиотека» — one catalog screen with sections (Навыки, Источники,
 * MCP/инструменты, Подключения, Интеграции, Расширения/Маркетплейс).
 *
 * This module is the pure half: the section registry plus query/grouping
 * helpers and cheap adapters that project already-loaded catalog data (skills,
 * sources, model connections, marketplace packs/tools) into flat searchable
 * rows. No React, no IPC — every export here is unit-tested.
 */
import type { BundledSkillPackStatus, LoadedSkill, LoadedSource, LlmConnectionWithStatus } from '../../../../shared/types'

export const LIBRARY_SECTION_IDS = [
  'skills',
  'sources',
  'mcp',
  'connections',
  'integrations',
  'extensions',
] as const

export type LibrarySectionId = (typeof LIBRARY_SECTION_IDS)[number]

export interface LibrarySection {
  id: LibrarySectionId
  /** i18n key for the visible section name. */
  labelKey: string
  /** i18n key for the one-line explanation, when one exists. */
  hintKey?: string
  /** Extra search terms (bilingual) so nav search works before data loads. */
  keywords: readonly string[]
}

/** Order here is the rail/nav order and the group order in search results. */
export const LIBRARY_SECTIONS: readonly LibrarySection[] = [
  {
    id: 'skills',
    labelKey: 'capabilityCatalog.skillsTitle',
    hintKey: 'capabilityCatalog.skillsDescription',
    keywords: ['навыки', 'skills', 'capabilities', 'умения'],
  },
  {
    id: 'sources',
    labelKey: 'connections.overview.sources',
    hintKey: 'workbench.library.hint.sources',
    keywords: ['источники', 'sources', 'провайдеры'],
  },
  {
    id: 'mcp',
    labelKey: 'workbench.library.section.mcp',
    hintKey: 'workbench.library.hint.mcp',
    keywords: ['mcp', 'инструменты', 'tools', 'серверы'],
  },
  {
    id: 'connections',
    labelKey: 'workbench.library.section.connections',
    hintKey: 'workbench.library.hint.connections',
    keywords: ['подключения', 'connections', 'соединения'],
  },
  {
    id: 'integrations',
    labelKey: 'capabilityCatalog.integrationsTitle',
    hintKey: 'capabilityCatalog.integrationsDescription',
    keywords: ['интеграции', 'integrations', 'каталог'],
  },
  {
    id: 'extensions',
    labelKey: 'workbench.library.section.extensions',
    hintKey: 'workbench.library.hint.extensions',
    keywords: ['расширения', 'маркетплейс', 'extensions', 'marketplace', 'пакеты'],
  },
]

export function librarySection(id: LibrarySectionId): LibrarySection {
  return LIBRARY_SECTIONS.find((section) => section.id === id) ?? LIBRARY_SECTIONS[0]!
}

export function isLibrarySectionId(value: unknown): value is LibrarySectionId {
  return typeof value === 'string' && (LIBRARY_SECTION_IDS as readonly string[]).includes(value)
}

/** One compact row in the library: a searchable projection of a catalog item. */
export interface LibraryEntry {
  /** Stable across a session; unique within a section. */
  id: string
  section: LibrarySectionId
  title: string
  subtitle?: string
  /** Extra searchable terms not shown in the row. */
  keywords?: readonly string[]
}

export interface LibrarySectionGroup {
  section: LibrarySection
  entries: LibraryEntry[]
}

/** Case- and whitespace-insensitive query normalization (locale-aware). */
export function normalizeLibraryQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

/**
 * Rows matching the query. An empty query matches everything (kept in the
 * caller's order); a non-empty query matches title, subtitle or keywords.
 */
export function searchLibrary(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const needle = normalizeLibraryQuery(query)
  if (!needle) return [...entries]
  return entries.filter((entry) =>
    [entry.title, entry.subtitle ?? '', ...(entry.keywords ?? [])].join(' ').toLocaleLowerCase().includes(needle),
  )
}

/** Per-section row counts, always present for every section (0 when empty). */
export function librarySectionCounts(entries: readonly LibraryEntry[]): Record<LibrarySectionId, number> {
  const counts = Object.fromEntries(LIBRARY_SECTION_IDS.map((id) => [id, 0])) as Record<LibrarySectionId, number>
  for (const entry of entries) counts[entry.section] += 1
  return counts
}

/**
 * Group entries by section in registry order, dropping empty groups and
 * sorting rows alphabetically so results are stable and comparable.
 */
export function groupLibrary(entries: readonly LibraryEntry[]): LibrarySectionGroup[] {
  const bySection = new Map<LibrarySectionId, LibraryEntry[]>()
  for (const entry of entries) {
    const bucket = bySection.get(entry.section)
    if (bucket) bucket.push(entry)
    else bySection.set(entry.section, [entry])
  }
  const groups: LibrarySectionGroup[] = []
  for (const section of LIBRARY_SECTIONS) {
    const bucket = bySection.get(section.id)
    if (!bucket || bucket.length === 0) continue
    groups.push({
      section,
      entries: [...bucket].sort((a, b) => a.title.localeCompare(b.title)),
    })
  }
  return groups
}

/**
 * Section nav filtered by the query. `labelOf` injects the translated section
 * name so the model stays free of i18n; an empty query keeps every section.
 */
export function filterLibrarySections(
  sections: readonly LibrarySection[],
  query: string,
  labelOf: (section: LibrarySection) => string,
): LibrarySection[] {
  const needle = normalizeLibraryQuery(query)
  if (!needle) return [...sections]
  return sections.filter((section) =>
    [labelOf(section), ...section.keywords].join(' ').toLocaleLowerCase().includes(needle),
  )
}

export function skillEntries(skills: readonly LoadedSkill[]): LibraryEntry[] {
  return skills.map((skill) => ({
    id: skill.slug,
    section: 'skills',
    title: skill.metadata.name,
    subtitle: skill.metadata.description,
    keywords: [skill.slug, skill.source],
  }))
}

export function sourceEntries(sources: readonly LoadedSource[]): LibraryEntry[] {
  return sources.map((source) => ({
    id: source.config.slug,
    section: source.config.type === 'mcp' ? 'mcp' : 'sources',
    title: source.config.name,
    subtitle: source.config.tagline ?? source.config.provider,
    keywords: [source.config.slug, source.config.provider, source.config.type],
  }))
}

export function modelEntries(models: readonly LlmConnectionWithStatus[]): LibraryEntry[] {
  return models.map((model) => ({
    id: model.slug,
    section: 'sources',
    title: model.name,
    subtitle: model.defaultModel ?? model.providerType,
    keywords: [model.slug, model.providerType, 'model', 'модель'],
  }))
}

/**
 * Marketplace packs and tools. `packs` carries the static inventory; the
 * bundled skill packs are folded in by the caller, not here.
 */
export function marketplaceEntries(input: {
  packs: readonly { id: string; title?: string; keywords?: readonly string[] }[]
  tools: readonly { id: string; title: string; packId: string; keywords?: readonly string[] }[]
}): LibraryEntry[] {
  const packTitles = new Map(input.packs.map((pack) => [pack.id, pack.title ?? pack.id]))
  return [
    ...input.packs.map((pack) => ({
      id: `pack:${pack.id}`,
      section: 'extensions' as const,
      title: pack.title ?? pack.id,
      subtitle: pack.id,
      keywords: ['pack', 'пакет', pack.id, ...(pack.keywords ?? [])],
    })),
    ...input.tools.map((tool) => ({
      id: `tool:${tool.id}`,
      section: 'extensions' as const,
      title: tool.title,
      subtitle: packTitles.get(tool.packId) ?? tool.packId,
      keywords: ['tool', 'инструмент', tool.id, tool.packId, ...(tool.keywords ?? [])],
    })),
  ]
}

/** Bundled skill packs double as marketplace rows in the «Расширения» section. */
export function bundledPackEntries(packs: readonly BundledSkillPackStatus[]): LibraryEntry[] {
  return packs.map((pack) => ({
    id: `bundled:${pack.slug}`,
    section: 'extensions',
    title: pack.slug,
    subtitle: pack.error ?? undefined,
    keywords: ['pack', 'навык', 'skill', ...pack.skills],
  }))
}

