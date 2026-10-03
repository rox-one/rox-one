import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensurePresetThemes, getAppThemesDir, getConfigPath, loadAppTheme } from '@rox/shared/config/storage'
import { PresetThemeSchema, ThemeOverrideSchema } from '@rox/shared/config/validators'
import type { PresetTheme, ThemeOverrides } from '@rox/shared/config/theme'
import { isWebThemeId } from './appearance-rpc'
import { expandPath } from '@rox/shared/utils'
import { loadWorkspaceConfig } from '@rox/shared/workspaces/storage'

/** Read the current bound scope without registry migration or folder auto-repair. */
export function readWebDefaultWorkspace(): { id: string; name: string } | null {
  try {
    const config = JSON.parse(readFileSync(getConfigPath(), 'utf8')) as Record<string, unknown>
    if (typeof config.activeWorkspaceId !== 'string' || !Array.isArray(config.workspaces)) return null
    const workspace = config.workspaces.find(value => value && typeof value === 'object'
      && value.id === config.activeWorkspaceId)
    if (!workspace || typeof workspace.id !== 'string' || !workspace.id || typeof workspace.name !== 'string'
      || typeof workspace.rootPath !== 'string' || !workspace.rootPath) return null
    const folder = loadWorkspaceConfig(expandPath(workspace.rootPath))
    if (!folder || folder.id !== workspace.id) return null
    return { id: workspace.id, name: workspace.name }
  } catch { return null }
}

function browserBackground<T extends { backgroundImage?: string }>(theme: T): T {
  const result = { ...theme }
  // No host filesystem URL or arbitrary local file bytes enter the browser.
  const safe = (image: string | undefined) => image === undefined
    || /^https?:\/\//i.test(image) || /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(image)
  if (!safe(result.backgroundImage)) delete result.backgroundImage
  return result
}

/** Read only regular, conservatively named preset files after schema validation. */
export function loadWebPresetTheme(id: string): PresetTheme | null {
  if (!isWebThemeId(id)) return null
  ensurePresetThemes()
  try {
    const path = join(getAppThemesDir(), `${id}.json`)
    if (!lstatSync(path).isFile()) return null
    const theme = PresetThemeSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!theme.success) return null
    return { id, path: '', theme: browserBackground(theme.data) }
  } catch { return null }
}

export function loadWebPresetThemes(): PresetTheme[] {
  ensurePresetThemes()
  try {
    return readdirSync(getAppThemesDir())
      .filter(file => file.endsWith('.json'))
      .map(file => loadWebPresetTheme(file.slice(0, -5)))
      .filter((theme): theme is PresetTheme => theme !== null)
      .sort((a, b) => a.id === 'default' ? -1 : b.id === 'default' ? 1
        : (a.theme.name || a.id).localeCompare(b.theme.name || b.id))
  } catch { return [] }
}

export function loadWebAppTheme(): ThemeOverrides | null {
  const theme = ThemeOverrideSchema.safeParse(loadAppTheme())
  return theme.success ? browserBackground(theme.data) : null
}
