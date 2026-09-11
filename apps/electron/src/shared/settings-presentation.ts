/**
 * Settings presentation metadata — visual grouping and search filtering.
 *
 * `settings-registry.ts` remains the canonical page catalog. This module only
 * assigns each registered page to a navigator group and filters pretranslated
 * rows. It must not import renderer code or duplicate page labels.
 */

import {
  SETTINGS_PAGES,
  type SettingsSubpage,
} from './settings-registry'

export type SettingsGroupId = 'agent' | 'application' | 'integrations' | 'workspace'

export interface SettingsGroupDefinition {
  id: SettingsGroupId
  labelKey: string
  pageIds: readonly SettingsSubpage[]
}

/**
 * Four stable navigator groups. Extra registry pages (`account`, `security`)
 * sit in Application so every SETTINGS_PAGES id appears exactly once.
 */
export const SETTINGS_GROUPS: readonly SettingsGroupDefinition[] = [
  {
    id: 'agent',
    labelKey: 'settings.navigator.groupAgent',
    pageIds: ['runtime', 'context', 'ai', 'permissions', 'input'],
  },
  {
    id: 'workspace',
    labelKey: 'settings.navigator.groupWorkspace',
    pageIds: ['workspace', 'labels', 'knowledge', 'extensions', 'import'],
  },
  {
    id: 'integrations',
    labelKey: 'settings.navigator.groupIntegrations',
    pageIds: ['marketplace', 'accounts', 'organizations', 'messaging', 'server', 'cloudRuns'],
  },
  {
    id: 'application',
    labelKey: 'settings.navigator.groupApplication',
    pageIds: ['account', 'app', 'appearance', 'security', 'shortcuts'],
  },
]

export interface SettingsPageRow {
  id: SettingsSubpage
  label: string
  description: string
}

export interface GroupedSettingsPages<T extends { id: SettingsSubpage }> {
  group: SettingsGroupDefinition
  pages: T[]
}

const GROUP_BY_PAGE_ID: ReadonlyMap<SettingsSubpage, SettingsGroupDefinition> = (() => {
  const map = new Map<SettingsSubpage, SettingsGroupDefinition>()
  for (const group of SETTINGS_GROUPS) {
    for (const pageId of group.pageIds) {
      if (map.has(pageId)) {
        throw new Error(`Settings page ${pageId} is assigned to more than one group`)
      }
      map.set(pageId, group)
    }
  }
  for (const page of SETTINGS_PAGES) {
    if (!map.has(page.id)) {
      throw new Error(`Settings page ${page.id} is not assigned to a presentation group`)
    }
  }
  return map
})()

export function getSettingsGroup(id: SettingsSubpage): SettingsGroupDefinition {
  const group = GROUP_BY_PAGE_ID.get(id)
  if (!group) {
    throw new Error(`Settings page ${id} is not assigned to a presentation group`)
  }
  return group
}

export function groupSettingsPages<T extends { id: SettingsSubpage }>(
  items: T[],
): GroupedSettingsPages<T>[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const item of items) {
    if (!GROUP_BY_PAGE_ID.has(item.id)) {
      throw new Error(`Settings page ${item.id} is not assigned to a presentation group`)
    }
  }

  return SETTINGS_GROUPS.map((group) => ({
    group,
    pages: group.pageIds
      .map((pageId) => byId.get(pageId))
      .filter((page): page is T => page !== undefined),
  })).filter((grouped) => grouped.pages.length > 0)
}

export function filterSettingsPages<T extends { label: string; description: string }>(
  items: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle),
  )
}
