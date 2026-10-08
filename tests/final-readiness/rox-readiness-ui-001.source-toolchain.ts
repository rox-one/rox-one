/**
 * W1-13 (#1510): where the UI-001 seed reads the host's genuine pinned
 * toolchain from. Never the disposable profile in ROX_CONFIG_DIR (that is
 * the copy destination), and never via resolveConfigDir() (which returns the
 * profile, or could run the visible-home migration on the host).
 *
 * Order: explicit `ROX_SEED_SOURCE_TOOLCHAIN`; else the flag-OFF host home
 * that holds a toolchain — `~/rox` if present, else the legacy hidden home
 * (which is also the compat symlink after a migration).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROX_COMPAT_SYMLINK_NAME, ROX_HOME_DIR_NAME } from '../../packages/shared/src/identity/manifest.ts'

export function seedSourceToolchainRoot(
  env: Record<string, string | undefined>,
  homeDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const explicit = env.ROX_SEED_SOURCE_TOOLCHAIN?.trim()
  if (explicit) return explicit
  const visible = join(homeDir, ROX_HOME_DIR_NAME, 'toolchain')
  const legacy = join(homeDir, ROX_COMPAT_SYMLINK_NAME, 'toolchain')
  if (exists(join(visible, 'state.json'))) return visible
  return legacy
}
