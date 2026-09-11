import { join, sep } from 'path'

/**
 * Local/dev/unsigned packaged builds must not chase the production update feed.
 * - CRAFT_DEV_RUNTIME is baked by electron:dist:dev:* (esbuild define)
 * - ~/Applications copies (e.g. Rox.app) are local installs, not release channel
 * - Ad-hoc codesign (CSC_IDENTITY_AUTO_DISCOVERY=false / unsigned local dist) is not release channel
 */
export function shouldSuppressUpdateFeed(options: {
  craftDevRuntime?: string
  homeDir: string
  execPath: string
  /** macOS codesign Signature=adhoc (or unsigned). */
  isAdHocSigned?: boolean
}): boolean {
  const flag = options.craftDevRuntime?.trim()
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') {
    return true
  }
  if (options.isAdHocSigned === true) {
    return true
  }
  const homeApps = join(options.homeDir, 'Applications')
  const execPath = options.execPath
  return execPath === homeApps || execPath.startsWith(homeApps + sep)
}

/** Compare dotted semver-ish versions: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[^0-9]+/).map((p) => Number.parseInt(p, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[^0-9]+/).map((p) => Number.parseInt(p, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  return 0
}

/**
 * Whether a downloaded update may be surfaced as "ready" (toast / menu).
 * Rejects when local already matches/exceeds feed, or a known cached version
 * does not match the feed version (stale downloadedUpdateHelper).
 */
export function shouldAcceptReadyUpdate(options: {
  localVersion: string
  feedVersion: string | null | undefined
  cachedVersion?: string | null
}): boolean {
  const feed = options.feedVersion?.trim()
  if (!feed) return false
  if (compareSemver(options.localVersion, feed) >= 0) {
    return false
  }
  const cached = options.cachedVersion?.trim()
  if (cached && compareSemver(cached, feed) !== 0) {
    return false
  }
  return true
}
