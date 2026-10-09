/**
 * First-party built-in extensions (B7, S-05 §3.3).
 *
 * Rox ships a small set of first-party features as `craft-native` extensions so
 * they appear in the Extension Center with a real status — there is no
 * marketplace/disk entity backing them. Record names are brands and
 * descriptions are Russian product copy (marketplace convention: RU text as
 * data, not an i18n key).
 */

import { parseExtensionManifest } from './manifest.ts'
import type { ExtensionRecord } from './types.ts'

export const BUILTIN_CLIPBOARD_HISTORY_ID = 'builtin:clipboard-history' as const
export const BUILTIN_KNOWLEDGE_MAP_ID = 'builtin:knowledge-map' as const

export const BUILTIN_FIRST_PARTY_RECORDS: ExtensionRecord[] = [
  {
    id: BUILTIN_CLIPBOARD_HISTORY_ID,
    manifest: parseExtensionManifest({
      id: BUILTIN_CLIPBOARD_HISTORY_ID,
      name: 'Rox History',
      version: '1.0.0',
      runtime: 'craft-native',
      permissions: ['ui.panel', 'ui.command'],
    }),
    category: 'apps',
    providerId: 'installed',
    status: 'enabled',
    worksIn: ['Командная палитра', 'Панели'],
    description:
      'История буфера обмена Rox: захват текста и скриншотов, поиск, избранное, теги и быстрый просмотр прямо в приложении.',
  },
  {
    id: BUILTIN_KNOWLEDGE_MAP_ID,
    manifest: parseExtensionManifest({
      id: BUILTIN_KNOWLEDGE_MAP_ID,
      name: 'Карта знаний',
      version: '1.0.0',
      runtime: 'craft-native',
      permissions: ['ui.panel', 'ui.command'],
    }),
    category: 'apps',
    providerId: 'installed',
    status: 'enabled',
    worksIn: ['Командная палитра', 'Панели'],
    description:
      'Автоматическая визуальная карта ваших знаний: документы контекста, память и заметки рабочего пространства на графе и в дереве.',
  },
]

/**
 * Append the first-party built-ins to `records`, de-duplicating by id. Existing
 * records win and their order is preserved; built-ins keep their declared order.
 */
export function mergeBuiltinFirstPartyRecords(records: ExtensionRecord[]): ExtensionRecord[] {
  const existing = new Set(records.map((record) => record.id))
  return [...records, ...BUILTIN_FIRST_PARTY_RECORDS.filter((record) => !existing.has(record.id))]
}