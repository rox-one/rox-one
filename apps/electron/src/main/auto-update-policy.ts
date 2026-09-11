import { join, sep } from 'path'

/**
 * Local/dev packaged builds must not chase the production update feed.
 * - CRAFT_DEV_RUNTIME is baked by electron:dist:dev:* (esbuild define)
 * - ~/Applications copies (e.g. Rox.app) are local installs, not release channel
 */
export function shouldSuppressUpdateFeed(options: {
  craftDevRuntime?: string
  homeDir: string
  execPath: string
}): boolean {
  const flag = options.craftDevRuntime?.trim()
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') {
    return true
  }
  const homeApps = join(options.homeDir, 'Applications')
  const execPath = options.execPath
  return execPath === homeApps || execPath.startsWith(homeApps + sep)
}
