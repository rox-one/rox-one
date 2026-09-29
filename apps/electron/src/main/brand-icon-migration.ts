import { createHash } from 'crypto'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * SHA-256 of every app mark that was ever auto-seeded into a new workspace as
 * `<workspace>/icon.png` (historic `apps/electron/resources/icon.png` versions).
 * A workspace icon that is byte-identical to one of these was never chosen by
 * the user, so it is safe to refresh it to the current Rox avatar.
 */
export const LEGACY_SEEDED_WORKSPACE_ICON_SHA256 = new Set<string>([
  '6b20c54f555d80579a89b25d39d96b1bfa223c63a7727652d7d34602ef941bef',
  '38a694c1cce7ba0594da42a704f2c9bf5b123ebdb3b5d006b2f62c341cfecc04',
  'aa9a0c2a92d65f8cb0dce9b359d6857e9e24e62749a289ecfb70e7bbce9386db',
  '47dbf62d365dc28e42ecc8fad63c132f6612ae55a1194909317b037b8484423f',
])

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Replace auto-seeded legacy brand icons with the current avatar.
 * Custom (user-chosen) workspace icons are never touched.
 * Returns the root paths whose icon was refreshed.
 */
export function refreshLegacySeededWorkspaceIcons(
  workspaces: ReadonlyArray<{ rootPath?: string | null }>,
  currentIconPath: string | undefined,
): string[] {
  if (!currentIconPath || !existsSync(currentIconPath)) return []
  const currentHash = sha256File(currentIconPath)
  const refreshed: string[] = []
  for (const ws of workspaces) {
    if (!ws.rootPath) continue
    const iconPath = join(ws.rootPath, 'icon.png')
    try {
      if (!existsSync(iconPath)) continue
      const hash = sha256File(iconPath)
      if (hash === currentHash || !LEGACY_SEEDED_WORKSPACE_ICON_SHA256.has(hash)) continue
      copyFileSync(currentIconPath, iconPath)
      refreshed.push(ws.rootPath)
    } catch {
      // best effort: a failed refresh just keeps the old icon
    }
  }
  return refreshed
}
