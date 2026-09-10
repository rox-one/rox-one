/**
 * Workspace-scoped recent settings pages.
 *
 * Stores at most five unique valid SettingsSubpage IDs, newest first, in
 * preferences.json under `settingsRecent.byWorkspace`.
 */

import {
  isValidSettingsSubpage,
  type SettingsSubpage,
} from '../../shared/settings-registry'

export const SETTINGS_RECENT_KEY = 'settingsRecent'
const RECENT_CAP = 5

export interface SettingsRecentPreference {
  byWorkspace: Record<string, SettingsSubpage[]>
}

function sanitizeRecent(value: unknown): SettingsSubpage[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<SettingsSubpage>()
  const result: SettingsSubpage[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !isValidSettingsSubpage(entry)) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
    if (result.length >= RECENT_CAP) break
  }
  return result
}

function asPrefsObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function readByWorkspace(prefs: Record<string, unknown>): Record<string, unknown> {
  const recent = prefs[SETTINGS_RECENT_KEY]
  if (!recent || typeof recent !== 'object' || Array.isArray(recent)) return {}
  const byWorkspace = (recent as Record<string, unknown>).byWorkspace
  if (!byWorkspace || typeof byWorkspace !== 'object' || Array.isArray(byWorkspace)) return {}
  return { ...(byWorkspace as Record<string, unknown>) }
}

export function parsePreferences(content: string): Record<string, unknown> {
  try {
    return asPrefsObject(JSON.parse(content) as unknown)
  } catch {
    return {}
  }
}

export function extractRecentSettings(
  prefs: unknown,
  workspaceId: string | null | undefined,
): SettingsSubpage[] {
  if (!workspaceId) return []
  const byWorkspace = readByWorkspace(asPrefsObject(prefs))
  return sanitizeRecent(byWorkspace[workspaceId])
}

export function upsertRecentSetting(
  prefs: unknown,
  workspaceId: string | null | undefined,
  subpage: SettingsSubpage,
): { prefs: Record<string, unknown>; recents: SettingsSubpage[] } {
  const nextPrefs = asPrefsObject(prefs)
  if (!workspaceId) {
    return { prefs: nextPrefs, recents: [] }
  }

  const recents = isValidSettingsSubpage(subpage)
    ? [subpage, ...extractRecentSettings(nextPrefs, workspaceId).filter((id) => id !== subpage)].slice(0, RECENT_CAP)
    : extractRecentSettings(nextPrefs, workspaceId)

  const byWorkspace = readByWorkspace(nextPrefs)
  byWorkspace[workspaceId] = recents
  nextPrefs[SETTINGS_RECENT_KEY] = { byWorkspace }
  nextPrefs.updatedAt = Date.now()
  return { prefs: nextPrefs, recents }
}

async function readPrefsDocument(): Promise<Record<string, unknown>> {
  try {
    const { content } = await window.electronAPI.readPreferences()
    return parsePreferences(content)
  } catch {
    return {}
  }
}

export async function readRecentSettings(
  workspaceId: string | null | undefined,
): Promise<SettingsSubpage[]> {
  return extractRecentSettings(await readPrefsDocument(), workspaceId)
}

export async function recordRecentSetting(
  workspaceId: string | null | undefined,
  subpage: SettingsSubpage,
): Promise<SettingsSubpage[]> {
  const current = await readPrefsDocument()
  const { prefs, recents } = upsertRecentSetting(current, workspaceId, subpage)
  if (!workspaceId) return recents
  try {
    await window.electronAPI.writePreferences(JSON.stringify(prefs, null, 2))
  } catch {
    // Private-mode / IPC failures still return the in-memory list.
  }
  return recents
}
