/**
 * W1-13 (#1510): side-effect-free location of the host's installed Rox
 * toolchain for dev probes and test seeds. Mirrors the flag-OFF config-dir
 * choice (`~/rox` when it holds a toolchain, else the legacy hidden home, which
 * is also the compat symlink after a migration) without calling
 * resolveConfigDir(): that honours ROX_CONFIG_DIR (often a disposable profile)
 * and, with storage.visible-root.v1 on, could migrate the real home.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ROX_COMPAT_SYMLINK_NAME, ROX_HOME_DIR_NAME } from '../../packages/shared/src/identity/manifest.ts'

export function hostRoxToolchainRoot(
  homeDir: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): string {
  const visible = join(homeDir, ROX_HOME_DIR_NAME, 'toolchain')
  if (exists(join(visible, 'state.json'))) return visible
  return join(homeDir, ROX_COMPAT_SYMLINK_NAME, 'toolchain')
}
