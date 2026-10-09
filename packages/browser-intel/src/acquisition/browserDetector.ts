/**
 * Browser installation discovery.
 *
 * Roots come from the shared profile-import module (`chromiumRootRel` /
 * `firefoxRootRel`) so the acquisition stage can never disagree with the
 * privileged importer about where a browser keeps its data; this module only
 * maps those roots to a vendor identity and resolves a best-effort executable.
 *
 * Every filesystem touch goes through an injected {@link ProfileFs} (or the
 * node-backed {@link defaultProfileFs}); discovery never opens a data store.
 */

import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  chromiumRootRel,
  firefoxRootRel,
  type ProfileFs,
} from '@rox/shared/browser/profile-import'

import type { BrowserFamily, BrowserVendorId, DetectedBrowser } from '../types.ts'

/** Node-backed {@link ProfileFs}. Reads are best-effort; write/remove are recursive. */
export function defaultProfileFs(): ProfileFs {
  return {
    exists: (path) => nodeFs.existsSync(path),
    readText: (path) => {
      try {
        return nodeFs.readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    writeText: (path, contents) => {
      nodeFs.mkdirSync(dirname(path), { recursive: true })
      nodeFs.writeFileSync(path, contents, 'utf8')
    },
    remove: (path) => nodeFs.rmSync(path, { recursive: true, force: true }),
    listPaths: (prefix) => {
      const dir = prefix.endsWith('/') ? prefix.replace(/\/+$/, '') : dirname(prefix)
      const base = prefix.endsWith('/') ? '' : basename(prefix)
      try {
        return nodeFs
          .readdirSync(dir)
          .filter((name) => name.startsWith(base))
          .map((name) => join(dir, name))
      } catch {
        return []
      }
    },
  }
}

export interface BrowserDetectorOptions {
  home?: string
  platform?: NodeJS.Platform
  fs?: ProfileFs
  /** Root-relative overrides; defaults to the shared root tables for `platform`. */
  roots?: { chromium?: string[]; firefox?: string[] }
  env?: NodeJS.ProcessEnv
}

const VENDOR_DISPLAY_NAMES: Record<BrowserVendorId, string> = {
  chrome: 'Google Chrome',
  'chrome-beta': 'Google Chrome Beta',
  'chrome-dev': 'Google Chrome Dev',
  'chrome-canary': 'Google Chrome Canary',
  chromium: 'Chromium',
  edge: 'Microsoft Edge',
  'edge-beta': 'Microsoft Edge Beta',
  'edge-dev': 'Microsoft Edge Dev',
  brave: 'Brave',
  arc: 'Arc',
  vivaldi: 'Vivaldi',
  opera: 'Opera',
  'opera-gx': 'Opera GX',
  yandex: 'Yandex Browser',
  'yandex-enterprise': 'Yandex Browser Enterprise',
  zen: 'Zen Browser',
  firefox: 'Firefox',
  'firefox-nightly': 'Firefox Nightly',
  'firefox-developer-edition': 'Firefox Developer Edition',
  safari: 'Safari',
  unknown: 'Unknown Browser',
}

export function displayNameForVendor(vendor: BrowserVendorId): string {
  return VENDOR_DISPLAY_NAMES[vendor]
}

/**
 * Ordered substring matchers over the lowercased root-relative path.
 *
 * Order encodes specificity: ring/channel suffixes (`Chrome Canary`, `Chrome
 * Beta`, `Chrome Dev`) must be tested before the plain vendor, and the Yandex
 * enterprise SKU before the consumer one.
 */
const CHROMIUM_VENDOR_MATCHERS: ReadonlyArray<readonly [string, BrowserVendorId]> = [
  ['yandexbrowserenterprise', 'yandex-enterprise'],
  ['yandex-browser-beta', 'yandex'],
  ['yandexbrowser', 'yandex'],
  ['yandex-browser', 'yandex'],
  ['operagx', 'opera-gx'],
  ['opera gx', 'opera-gx'],
  ['com.operasoftware.opera', 'opera'],
  ['/opera', 'opera'],
  ['chrome canary', 'chrome-canary'],
  ['chrome sxs', 'chrome-canary'],
  ['google-chrome-canary', 'chrome-canary'],
  ['chrome beta', 'chrome-beta'],
  ['google-chrome-beta', 'chrome-beta'],
  ['chrome dev', 'chrome-dev'],
  ['google-chrome-unstable', 'chrome-dev'],
  ['google/chrome', 'chrome'],
  ['google-chrome', 'chrome'],
  ['microsoft-edge-beta', 'edge-beta'],
  ['microsoft edge beta', 'edge-beta'],
  ['microsoft/edge beta', 'edge-beta'],
  ['microsoft-edge-dev', 'edge-dev'],
  ['microsoft edge dev', 'edge-dev'],
  ['microsoft/edge dev', 'edge-dev'],
  ['microsoft-edge', 'edge'],
  ['microsoft edge', 'edge'],
  ['microsoft/edge', 'edge'],
  ['bravesoftware', 'brave'],
  ['brave-browser', 'brave'],
  ['vivaldi', 'vivaldi'],
  ['support/arc/', 'arc'],
  ['/zen', 'zen'],
  ['zen-browser', 'zen'],
  ['app.zen-browser.zen', 'zen'],
  ['chromium', 'chromium'],
]

const FIREFOX_VENDOR_MATCHERS: ReadonlyArray<readonly [string, BrowserVendorId]> = [
  ['nightly', 'firefox-nightly'],
  ['developer edition', 'firefox-developer-edition'],
  ['firefox-dev', 'firefox-developer-edition'],
]

export function vendorForChromiumRoot(rootRel: string): BrowserVendorId {
  const rel = rootRel.toLowerCase()
  for (const [needle, vendor] of CHROMIUM_VENDOR_MATCHERS) {
    if (rel.includes(needle)) return vendor
  }
  return 'unknown'
}

export function vendorForFirefoxRoot(rootRel: string): BrowserVendorId {
  const rel = rootRel.toLowerCase()
  for (const [needle, vendor] of FIREFOX_VENDOR_MATCHERS) {
    if (rel.includes(needle)) return vendor
  }
  return 'firefox'
}

interface VendorExecutableSpec {
  mac?: { app: string; binary: string }
  /** Relative app dir under `%LOCALAPPDATA%` / `%PROGRAMFILES%`, plus the exe name. */
  win?: { localAppData?: string; programFiles?: string; binary: string }
  linux?: { bin?: string; opt?: string; snap?: string }
}

const VENDOR_EXECUTABLES: Partial<Record<BrowserVendorId, VendorExecutableSpec>> = {
  chrome: {
    mac: { app: 'Google Chrome', binary: 'Google Chrome' },
    win: { localAppData: 'Google/Chrome/Application', programFiles: 'Google/Chrome/Application', binary: 'chrome.exe' },
    linux: { bin: 'google-chrome', opt: 'google/chrome' },
  },
  'chrome-beta': {
    mac: { app: 'Google Chrome Beta', binary: 'Google Chrome' },
    win: { localAppData: 'Google/Chrome Beta/Application', binary: 'chrome.exe' },
    linux: { bin: 'google-chrome-beta' },
  },
  'chrome-dev': {
    mac: { app: 'Google Chrome Dev', binary: 'Google Chrome' },
    win: { localAppData: 'Google/Chrome Dev/Application', binary: 'chrome.exe' },
    linux: { bin: 'google-chrome-unstable' },
  },
  'chrome-canary': {
    mac: { app: 'Google Chrome Canary', binary: 'Google Chrome Canary' },
    win: { localAppData: 'Google/Chrome SxS/Application', binary: 'chrome.exe' },
    linux: { bin: 'google-chrome-canary' },
  },
  chromium: {
    mac: { app: 'Chromium', binary: 'Chromium' },
    win: { localAppData: 'Chromium/Application', binary: 'chrome.exe' },
    linux: { bin: 'chromium', snap: 'chromium' },
  },
  edge: {
    mac: { app: 'Microsoft Edge', binary: 'Microsoft Edge' },
    win: { localAppData: 'Microsoft/Edge/Application', programFiles: 'Microsoft/Edge/Application', binary: 'msedge.exe' },
    linux: { bin: 'microsoft-edge' },
  },
  'edge-beta': {
    mac: { app: 'Microsoft Edge Beta', binary: 'Microsoft Edge Beta' },
    win: { localAppData: 'Microsoft/Edge Beta/Application', binary: 'msedge.exe' },
    linux: { bin: 'microsoft-edge-beta' },
  },
  'edge-dev': {
    mac: { app: 'Microsoft Edge Dev', binary: 'Microsoft Edge Dev' },
    win: { localAppData: 'Microsoft/Edge Dev/Application', binary: 'msedge.exe' },
    linux: { bin: 'microsoft-edge-dev' },
  },
  brave: {
    mac: { app: 'Brave Browser', binary: 'Brave Browser' },
    win: { localAppData: 'BraveSoftware/Brave-Browser/Application', programFiles: 'BraveSoftware/Brave-Browser/Application', binary: 'brave.exe' },
    linux: { bin: 'brave-browser' },
  },
  arc: {
    mac: { app: 'Arc', binary: 'Arc' },
  },
  vivaldi: {
    mac: { app: 'Vivaldi', binary: 'Vivaldi' },
    win: { localAppData: 'Vivaldi/Application', programFiles: 'Vivaldi/Application', binary: 'vivaldi.exe' },
    linux: { bin: 'vivaldi' },
  },
  opera: {
    mac: { app: 'Opera', binary: 'Opera' },
    win: { localAppData: 'Programs/Opera', binary: 'opera.exe' },
    linux: { bin: 'opera' },
  },
  'opera-gx': {
    mac: { app: 'Opera GX', binary: 'Opera GX' },
    win: { localAppData: 'Programs/Opera GX', binary: 'opera.exe' },
    linux: { bin: 'opera-gx' },
  },
  yandex: {
    mac: { app: 'Yandex', binary: 'Yandex' },
    win: { localAppData: 'Yandex/YandexBrowser/Application', programFiles: 'Yandex/YandexBrowser/Application', binary: 'browser.exe' },
    linux: { bin: 'yandex-browser', opt: 'yandex-browser' },
  },
  'yandex-enterprise': {
    mac: { app: 'Yandex', binary: 'Yandex' },
    win: { localAppData: 'Yandex/YandexBrowserEnterprise/Application', programFiles: 'Yandex/YandexBrowserEnterprise/Application', binary: 'browser.exe' },
    linux: { bin: 'yandex-browser' },
  },
  zen: {
    mac: { app: 'Zen', binary: 'zen' },
    win: { localAppData: 'Zen Browser', binary: 'zen.exe' },
    linux: { bin: 'zen-browser', snap: 'zen' },
  },
  firefox: {
    mac: { app: 'Firefox', binary: 'firefox' },
    win: { localAppData: 'Mozilla Firefox', programFiles: 'Mozilla Firefox', binary: 'firefox.exe' },
    linux: { bin: 'firefox', snap: 'firefox' },
  },
  'firefox-nightly': {
    mac: { app: 'Firefox Nightly', binary: 'firefox' },
    win: { programFiles: 'Firefox Nightly', binary: 'firefox.exe' },
    linux: { bin: 'firefox-nightly' },
  },
  'firefox-developer-edition': {
    mac: { app: 'Firefox Developer Edition', binary: 'firefox' },
    win: { programFiles: 'Firefox Developer Edition', binary: 'firefox.exe' },
    linux: { bin: 'firefox-developer-edition' },
  },
  safari: {
    mac: { app: 'Safari', binary: 'Safari' },
  },
}

/** Ordered candidate paths for a vendor on `platform`; never touches the disk. */
export function executableCandidates(
  vendor: BrowserVendorId,
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const spec = VENDOR_EXECUTABLES[vendor]
  if (!spec) return []
  const candidates: string[] = []
  if (platform === 'darwin') {
    if (!spec.mac) return candidates
    for (const base of ['/Applications', `${home}/Applications`]) {
      candidates.push(`${base}/${spec.mac.app}.app/Contents/MacOS/${spec.mac.binary}`)
    }
    return candidates
  }
  if (platform === 'win32') {
    if (!spec.win) return candidates
    const localRoot = env.LOCALAPPDATA ?? `${home}/AppData/Local`
    const localDir = spec.win.localAppData ?? spec.win.programFiles
    if (localDir) candidates.push(`${localRoot}/${localDir}/${spec.win.binary}`)
    const programDir = spec.win.programFiles ?? spec.win.localAppData
    if (programDir) {
      candidates.push(`${env.PROGRAMFILES ?? 'C:/Program Files'}/${programDir}/${spec.win.binary}`)
      candidates.push(`${env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)'}/${programDir}/${spec.win.binary}`)
    }
    return candidates
  }
  if (!spec.linux) return candidates
  if (spec.linux.bin) {
    candidates.push(`/usr/bin/${spec.linux.bin}`)
    candidates.push(`/usr/local/bin/${spec.linux.bin}`)
  }
  if (spec.linux.snap) candidates.push(`/snap/bin/${spec.linux.snap}`)
  if (spec.linux.opt) candidates.push(`/opt/${spec.linux.opt}/${spec.linux.bin ?? spec.linux.opt}`)
  if (spec.linux.bin) candidates.push(`${home}/.local/bin/${spec.linux.bin}`)
  return candidates
}

/** Read the Chromium `Local State` version; every read is guarded. */
export function readChromiumVersion(fs: ProfileFs, rootPath: string): string | null {
  try {
    const raw = fs.readText(`${rootPath}/Local State`)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as {
      stats?: { last_version?: unknown }
      browser?: { last_version?: unknown }
      version?: unknown
    }
    for (const value of [parsed.stats?.last_version, parsed.browser?.last_version, parsed.version]) {
      if (typeof value === 'string' && value.length > 0) return value
    }
    return null
  } catch {
    return null
  }
}

export function detectBrowsers(options: BrowserDetectorOptions = {}): DetectedBrowser[] {
  const platform = options.platform ?? process.platform
  const fs = options.fs ?? defaultProfileFs()
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const chromiumRoots = options.roots?.chromium ?? chromiumRootRel(platform)
  const firefoxRoots = options.roots?.firefox ?? firefoxRootRel(platform)

  const detected: DetectedBrowser[] = []
  const collect = (rootRel: string, family: BrowserFamily, vendor: BrowserVendorId): void => {
    const rootPath = `${home}/${rootRel}`
    if (!fs.exists(rootPath)) return
    detected.push({
      vendor,
      family,
      displayName: displayNameForVendor(vendor),
      platform,
      rootPath,
      executablePath: executableCandidates(vendor, platform, home, env).find((candidate) => fs.exists(candidate)) ?? null,
      version: family === 'chromium' ? readChromiumVersion(fs, rootPath) : null,
    })
  }

  for (const rootRel of chromiumRoots) collect(rootRel, 'chromium', vendorForChromiumRoot(rootRel))
  for (const rootRel of firefoxRoots) collect(rootRel, 'firefox', vendorForFirefoxRoot(rootRel))
  return detected
}