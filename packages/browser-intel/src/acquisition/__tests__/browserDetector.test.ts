import { describe, expect, test } from 'bun:test'

import type { ProfileFs } from '@rox/shared/browser/profile-import'

import { detectBrowsers } from '../browserDetector.ts'

/** In-memory {@link ProfileFs}: a path exists when it is a seeded file or a prefix of one. */
function memoryFs(seed: Record<string, string>): ProfileFs {
  const files = new Map(Object.entries(seed))
  return {
    exists: (path) => [...files.keys()].some((key) => key === path || key.startsWith(`${path}/`)),
    readText: (path) => files.get(path) ?? null,
    writeText: (path, contents) => {
      files.set(path, contents)
    },
    remove: (path) => {
      files.delete(path)
    },
    listPaths: (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
  }
}

describe('detectBrowsers', () => {
  test('maps a macOS tree to vendors and resolves a fake executable', () => {
    const home = '/Users/me'
    const support = `${home}/Library/Application Support`
    const fs = memoryFs({
      [`${support}/Google/Chrome/Local State`]: JSON.stringify({ stats: { last_version: '131.0.0.0' } }),
      [`${support}/BraveSoftware/Brave-Browser/Local State`]: '{}',
      [`${support}/Firefox/profiles.ini`]: '[Profile0]\nName=default\nPath=xyz\nIsRelative=1\n',
      [`${support}/Arc/User Data/Local State`]: '{}',
      [`${support}/com.operasoftware.Opera/Local State`]: '{}',
      [`${support}/Yandex/YandexBrowser/Local State`]: '{}',
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']: 'binary',
    })

    const detected = detectBrowsers({ platform: 'darwin', fs, home })
    expect(detected.map((browser) => browser.vendor).sort()).toEqual([
      'arc',
      'brave',
      'chrome',
      'firefox',
      'opera',
      'yandex',
    ])

    const chrome = detected.find((browser) => browser.vendor === 'chrome')!
    expect(chrome.family).toBe('chromium')
    expect(chrome.displayName).toBe('Google Chrome')
    expect(chrome.platform).toBe('darwin')
    expect(chrome.executablePath).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(chrome.version).toBe('131.0.0.0')

    const firefox = detected.find((browser) => browser.vendor === 'firefox')!
    expect(firefox.family).toBe('firefox')
    expect(firefox.executablePath).toBeNull()
    expect(firefox.version).toBeNull()

    const brave = detected.find((browser) => browser.vendor === 'brave')!
    expect(brave.executablePath).toBeNull()
  })

  test('resolves linux executables from /usr, /usr/local and /snap', () => {
    const home = '/home/me'
    const fs = memoryFs({
      [`${home}/.config/google-chrome/Default/History`]: 'sqlite',
      [`${home}/.config/chromium/Default/History`]: 'sqlite',
      [`${home}/.config/BraveSoftware/Brave-Browser/Default/History`]: 'sqlite',
      [`${home}/.mozilla/firefox/profiles.ini`]: '[Profile0]\nName=default\nPath=xyz\nIsRelative=1\n',
      '/usr/bin/google-chrome': 'bin',
      '/usr/local/bin/chromium': 'bin',
      '/usr/bin/brave-browser': 'bin',
      '/usr/bin/firefox': 'bin',
    })

    const detected = detectBrowsers({ platform: 'linux', fs, home })
    const byVendor = new Map(detected.map((browser) => [browser.vendor, browser]))

    expect([...byVendor.keys()].sort()).toEqual(['brave', 'chrome', 'chromium', 'firefox'])
    expect(byVendor.get('chrome')!.executablePath).toBe('/usr/bin/google-chrome')
    expect(byVendor.get('chromium')!.executablePath).toBe('/usr/local/bin/chromium')
    expect(byVendor.get('brave')!.executablePath).toBe('/usr/bin/brave-browser')
    expect(byVendor.get('firefox')!.executablePath).toBe('/usr/bin/firefox')
    expect(byVendor.get('firefox')!.family).toBe('firefox')
  })

  test('resolves win32 executables from LOCALAPPDATA and PROGRAMFILES', () => {
    const home = 'C:/Users/me'
    const env = {
      LOCALAPPDATA: `${home}/AppData/Local`,
      PROGRAMFILES: 'C:/Program Files',
      'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
    }
    const fs = memoryFs({
      [`${home}/AppData/Local/Google/Chrome/User Data/Local State`]: '{}',
      [`${home}/AppData/Local/Microsoft/Edge/User Data/Local State`]: '{}',
      [`${home}/AppData/Local/BraveSoftware/Brave-Browser/User Data/Local State`]: '{}',
      ['C:/Program Files/Google/Chrome/Application/chrome.exe']: 'bin',
      [`${env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe`]: 'bin',
    })

    const detected = detectBrowsers({ platform: 'win32', fs, home, env })
    const byVendor = new Map(detected.map((browser) => [browser.vendor, browser]))

    expect(byVendor.get('chrome')!.executablePath).toBe('C:/Program Files/Google/Chrome/Application/chrome.exe')
    expect(byVendor.get('edge')!.executablePath).toBe(`${env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe`)
    // Brave is installed but no executable is present in any candidate location.
    expect(byVendor.get('brave')!.executablePath).toBeNull()
  })

  test('maps an unrecognised root to vendor unknown while keeping its family', () => {
    const home = '/home/me'
    const fs = memoryFs({ [`${home}/Weird Browser/User Data/Default/History`]: 'sqlite' })
    const detected = detectBrowsers({
      platform: 'linux',
      fs,
      home,
      roots: { chromium: ['Weird Browser/User Data'], firefox: [] },
    })
    expect(detected).toHaveLength(1)
    expect(detected[0]!.vendor).toBe('unknown')
    expect(detected[0]!.family).toBe('chromium')
  })

  test('omits a browser whose data root is absent (no phantom Firefox)', () => {
    const home = '/Users/me'
    const support = `${home}/Library/Application Support`
    const fs = memoryFs({ [`${support}/Google/Chrome/Local State`]: '{}' })
    const detected = detectBrowsers({ platform: 'darwin', fs, home })
    expect(detected.map((browser) => browser.vendor)).toEqual(['chrome'])
  })
})