/**
 * W1-13 (#1510): where the UI-001 seed reads the host's genuine pinned
 * toolchain from. Never the disposable profile in ROX_CONFIG_DIR (that is
 * the copy destination), and never via resolveConfigDir() (which returns the
 * profile, or could run the visible-home migration on the host).
 *
 * Order: explicit `ROX_SEED_SOURCE_TOOLCHAIN`; else hostRoxToolchainRoot().
 */
import { existsSync } from 'node:fs'
import { hostRoxToolchainRoot } from '../../scripts/lib/host-rox-toolchain.ts'

export function seedSourceToolchainRoot(
  env: Record<string, string | undefined>,
  homeDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const explicit = env.ROX_SEED_SOURCE_TOOLCHAIN?.trim()
  if (explicit) return explicit
  return hostRoxToolchainRoot(homeDir, exists)
}
