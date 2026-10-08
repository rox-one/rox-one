import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export function resolveAppResourcesBase(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app') : join(__dirname, '..')
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => p && existsSync(p))
}

/** Full-color PNG used for dock badge base and explicit dock.setIcon in packaged builds. */
export function resolveAppIconPngPath(): string | undefined {
  const resourcesBase = resolveAppResourcesBase()
  return firstExisting([
    join(__dirname, 'resources/icon.png'),
    join(__dirname, '../resources/icon.png'),
    join(resourcesBase, 'resources/icon.png'),
    join(resourcesBase, 'resources/workspace-icon.png'),
    join(process.resourcesPath ?? '', 'app/resources/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
  ])
}
