/**
 * One-screen grouping for Extension Center (H4 / S-05).
 * Projection only — does not move skills/sources/automations on disk.
 */

export const EXTENSION_CENTER_GROUPS = ['skills', 'sources', 'automations', 'marketplace'] as const

export type ExtensionCenterGroupId = (typeof EXTENSION_CENTER_GROUPS)[number]

export interface ExtensionCenterItem {
  id: string
  category?: string
}

export function extensionCenterGroupFor(item: ExtensionCenterItem): ExtensionCenterGroupId {
  if (item.id.startsWith('skill:')) return 'skills'
  if (item.id.startsWith('source:')) return 'sources'
  if (item.id.startsWith('automation:')) return 'automations'
  if (item.category === 'sources') return 'sources'
  if (item.category === 'automations') return 'automations'
  if (item.category === 'skills' && !item.id.startsWith('marketplace:')) return 'skills'
  return 'marketplace'
}

export function groupExtensionCenterRecords<T extends ExtensionCenterItem>(
  records: readonly T[],
): Record<ExtensionCenterGroupId, T[]> {
  const groups: Record<ExtensionCenterGroupId, T[]> = {
    skills: [],
    sources: [],
    automations: [],
    marketplace: [],
  }
  for (const record of records) {
    groups[extensionCenterGroupFor(record)].push(record)
  }
  return groups
}

export function canToggleSkillOrSource(id: string): boolean {
  return id.startsWith('skill:') || id.startsWith('source:')
}
