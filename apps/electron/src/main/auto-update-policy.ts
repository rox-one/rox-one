import { join, sep } from 'path'
import { compare, valid } from 'semver'

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

/** Invalid versions cannot authorize an update or match a cached installer. */
export function isValidUpdateVersion(version: string): boolean {
  return valid(version.trim()) !== null
}

/** SemVer precedence includes prereleases and ignores build metadata. */
export function compareSemver(a: string, b: string): number {
  const left = valid(a.trim())
  const right = valid(b.trim())
  return left && right ? compare(left, right) : Number.NaN
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
  const ordering = compareSemver(options.localVersion, feed)
  if (!Number.isFinite(ordering) || ordering >= 0) {
    return false
  }
  const cached = options.cachedVersion?.trim()
  if (cached && compareSemver(cached, feed) !== 0) {
    return false
  }
  return true
}


/** Unsigned /Applications releases can explicitly check public metadata only.
 * User-local/dev copies keep their existing feed suppression. */
export function shouldOfferManualReleaseCheck(options: {
  craftDevRuntime?: string; homeDir: string; execPath: string; isAdHocSigned?: boolean;
}): boolean {
  return options.isAdHocSigned === true
    && options.execPath.startsWith('/Applications/')
    && !shouldSuppressUpdateFeed({ ...options, isAdHocSigned: false })
}
