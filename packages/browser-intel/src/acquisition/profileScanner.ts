/**
 * Profile enumeration for the device's installed browsers.
 *
 * Chromium profile folders and Firefox `profiles.ini` entries come from the
 * shared discovery module; this module adds vendor identity and the concrete
 * store paths the staging stage will copy. The one addition is a Firefox
 * fallback: when `profiles.ini` is missing (a freshly copied root, a packaged
 * profile, a partially-migrated install) the hash-named profile directories are
 * enumerated directly from the root.
 */

import { basename } from 'node:path'
import { homedir } from 'node:os'

import {
  chromiumRootRel,
  discoverBrowserProfiles,
  firefoxRootRel,
  type ProfileFs,
} from '@rox/shared/browser/profile-import'

import {
  defaultProfileFs,
  displayNameForVendor,
  vendorForChromiumRoot,
  vendorForFirefoxRoot,
} from './browserDetector.ts'
import type {
  BrowserVendorId,
  ProfileState,
  ProfileStorePaths,
  ScannedBrowserProfile,
} from '../types.ts'

export interface ProfileScannerOptions {
  home?: string
  platform?: NodeJS.Platform
  fs?: ProfileFs
  roots?: { chromium?: string[]; firefox?: string[] }
  env?: NodeJS.ProcessEnv
  now?: number
  /** Restrict the result to these vendors (applied last). */
  vendors?: BrowserVendorId[]
  /**
   * Neither value filters the result: a running profile is still reported so
   * the caller can shadow-copy its live databases. Present for callers that
   * want to distinguish "list running profiles" from "list all".
   */
  includeRunning?: boolean
}

/** Firefox profile directories are `<8 hex-ish chars>.<name>`, e.g. `a1b2c3d4.default-release`. */
const FIREFOX_HASH_DIR = /^[a-z0-9]{8}\./

function buildStores(family: string, profilePath: string, fs: ProfileFs): ProfileStorePaths {
  const pick = (name: string): string | null => {
    const candidate = `${profilePath}/${name}`
    return fs.exists(candidate) ? candidate : null
  }
  if (family === 'chromium') {
    return { history: pick('History'), bookmarks: pick('Bookmarks'), places: null, cookies: pick('Cookies') }
  }
  if (family === 'firefox') {
    // Firefox keeps visits, bookmarks and places metadata in one database.
    const places = pick('places.sqlite')
    return { history: places, bookmarks: places, places, cookies: pick('cookies.sqlite') }
  }
  return { history: null, bookmarks: null, places: null, cookies: null }
}

/**
 * Directories under a Firefox root whose name looks like a profile hash.
 *
 * `listPaths` may return direct children (node adapter) or descend into the
 * tree (in-memory test adapters); taking the first path segment after the root
 * handles both.
 */
function listFirefoxHashDirs(fs: ProfileFs, root: string): string[] {
  const prefix = `${root}/`
  const names = new Set<string>()
  for (const entry of fs.listPaths(prefix)) {
    if (!entry.startsWith(prefix)) continue
    const segment = entry.slice(prefix.length).split('/')[0] ?? ''
    if (FIREFOX_HASH_DIR.test(segment)) names.add(segment)
  }
  return [...names].sort().map((name) => `${root}/${name}`)
}

function firefoxFallbackState(fs: ProfileFs, profilePath: string): ProfileState {
  if (fs.exists(`${profilePath}/parent.lock`)) return 'running'
  return fs.exists(`${profilePath}/places.sqlite`) ? 'ok' : 'unsupported'
}

export function scanProfiles(options: ProfileScannerOptions = {}): ScannedBrowserProfile[] {
  const platform = options.platform ?? process.platform
  const fs = options.fs ?? defaultProfileFs()
  const home = options.home ?? homedir()
  const now = options.now ?? Date.now()

  const chromiumRels = options.roots?.chromium ?? chromiumRootRel(platform)
  const firefoxRels = options.roots?.firefox ?? firefoxRootRel(platform)
  // Longest root first so `.config/google-chrome` never claims a
  // `.config/google-chrome-beta/Default` path.
  const roots = [
    ...chromiumRels.map((rel) => ({ rel, abs: `${home}/${rel}`, chromium: true })),
    ...firefoxRels.map((rel) => ({ rel, abs: `${home}/${rel}`, chromium: false })),
  ].sort((a, b) => b.abs.length - a.abs.length)
  const firefoxRoots = roots.filter((root) => !root.chromium).map((root) => root.abs)

  const vendorForPath = (profilePath: string): BrowserVendorId => {
    for (const root of roots) {
      if (profilePath === root.abs || profilePath.startsWith(`${root.abs}/`)) {
        return root.chromium ? vendorForChromiumRoot(root.rel) : vendorForFirefoxRoot(root.rel)
      }
    }
    return 'unknown'
  }

  const toScanned = (
    profileId: string,
    vendor: BrowserVendorId,
    family: ScannedBrowserProfile['family'],
    name: string,
    profilePath: string,
    lastUsedAt: number | null,
    state: ProfileState,
  ): ScannedBrowserProfile => ({
    profileId,
    vendor,
    family,
    displayName: displayNameForVendor(vendor),
    name,
    path: profilePath,
    lastUsedAt,
    state,
    stores: buildStores(family, profilePath, fs),
  })

  const profiles: ScannedBrowserProfile[] = []
  const firefoxRootSet = new Set(firefoxRoots)
  for (const discovered of discoverBrowserProfiles({ home, platform, fs, now })) {
    // A Firefox root without profiles.ini yields a single root-level
    // placeholder; the hash-directory fallback below replaces it.
    if (discovered.family === 'firefox' && firefoxRootSet.has(discovered.path)) continue
    const vendor = discovered.family === 'safari' ? 'safari' : vendorForPath(discovered.path)
    profiles.push(
      toScanned(
        discovered.id,
        vendor,
        discovered.family,
        discovered.name,
        discovered.path,
        discovered.lastUsedAt,
        discovered.state,
      ),
    )
  }

  for (const root of firefoxRoots) {
    if (!fs.exists(root) || fs.readText(`${root}/profiles.ini`) !== null) continue
    for (const dir of listFirefoxHashDirs(fs, root)) {
      const vendor = vendorForPath(dir)
      profiles.push(
        toScanned(
          `firefox:${dir}`,
          vendor,
          'firefox',
          basename(dir),
          dir,
          null,
          firefoxFallbackState(fs, dir),
        ),
      )
    }
  }

  if (options.vendors && options.vendors.length > 0) {
    const wanted = new Set(options.vendors)
    return profiles.filter((profile) => wanted.has(profile.vendor))
  }
  return profiles
}