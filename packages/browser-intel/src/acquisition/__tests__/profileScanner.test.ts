import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'

import type { ProfileFs } from '@rox/shared/browser/profile-import'

import { scanProfiles } from '../profileScanner.ts'

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

describe('scanProfiles', () => {
  test('reads Chromium Local State profiles with their store paths', () => {
    const home = '/home/me'
    const root = `${home}/.config/google-chrome`
    const fs = memoryFs({
      [`${root}/Local State`]: JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Work', active_time: 1_700_000_000_000 },
            'Profile 1': { name: 'Play', active_time: 1_700_000_100_000 },
          },
        },
      }),
      [`${root}/Default/History`]: 'sqlite',
      [`${root}/Default/Bookmarks`]: '{"roots":{}}',
      [`${root}/Default/Cookies`]: 'cookies',
      [`${root}/Profile 1/History`]: 'sqlite',
    })

    const profiles = scanProfiles({ home, platform: 'linux', fs, now: 1_700_000_200_000 })
    expect(profiles).toHaveLength(2)

    const work = profiles.find((profile) => profile.name === 'Work')!
    expect(work.profileId).toBe(`chromium:${root}/Default`)
    expect(work.vendor).toBe('chrome')
    expect(work.family).toBe('chromium')
    expect(work.stores.history).toBe(`${root}/Default/History`)
    expect(work.stores.bookmarks).toBe(`${root}/Default/Bookmarks`)
    expect(work.stores.places).toBeNull()
    expect(work.stores.cookies).toBe(`${root}/Default/Cookies`)

    const play = profiles.find((profile) => profile.name === 'Play')!
    expect(play.vendor).toBe('chrome')
    expect(play.stores.history).toBe(`${root}/Profile 1/History`)
    expect(play.stores.bookmarks).toBeNull()
    expect(play.stores.cookies).toBeNull()
  })

  test('falls back to hash directories when Firefox profiles.ini is absent', () => {
    const home = '/home/me'
    const root = `${home}/.mozilla/firefox`
    const fs = memoryFs({
      [`${root}/abcd1234.default-release/places.sqlite`]: 'db',
      [`${root}/ef567890.default/cookies.sqlite`]: 'cookies',
    })

    const profiles = scanProfiles({ home, platform: 'linux', fs })
    expect(profiles.map((profile) => profile.name).sort()).toEqual(['abcd1234.default-release', 'ef567890.default'])

    const withPlaces = profiles.find((profile) => profile.name === 'abcd1234.default-release')!
    expect(withPlaces.profileId).toBe(`firefox:${root}/abcd1234.default-release`)
    expect(withPlaces.vendor).toBe('firefox')
    expect(withPlaces.family).toBe('firefox')
    expect(withPlaces.state).toBe('ok')
    expect(withPlaces.stores.history).toBe(`${root}/abcd1234.default-release/places.sqlite`)
    expect(withPlaces.stores.bookmarks).toBe(`${root}/abcd1234.default-release/places.sqlite`)
    expect(withPlaces.stores.places).toBe(`${root}/abcd1234.default-release/places.sqlite`)
    expect(withPlaces.stores.cookies).toBeNull()

    const withoutPlaces = profiles.find((profile) => profile.name === 'ef567890.default')!
    expect(withoutPlaces.state).toBe('unsupported')
    expect(withoutPlaces.stores.places).toBeNull()
    expect(withoutPlaces.stores.cookies).toBe(`${root}/ef567890.default/cookies.sqlite`)
  })

  test('a data root with no Local State and no Default resolves no stores', () => {
    const home = '/Users/me'
    const root = `${home}/Library/Application Support/Chromium`
    const fs = memoryFs({
      [`${root}/Crashpad/settings.dat`]: 'x',
      [`${root}/NativeMessagingHosts/com.example.json`]: '{}',
    })

    const profiles = scanProfiles({ home, platform: 'darwin', fs })
    expect(profiles).toHaveLength(1)
    const profile = profiles[0]!
    expect(profile.vendor).toBe('chromium')
    expect(profile.state).toBe('unsupported')
    expect(profile.stores).toEqual({ history: null, bookmarks: null, places: null, cookies: null })
  })

  test('leaves bookmarks null when Bookmarks is absent (account bookmarks are never substituted)', () => {
    const home = '/Users/me'
    const root = `${home}/Library/Application Support/BraveSoftware/Brave-Browser`
    const fs = memoryFs({
      [`${root}/Local State`]: JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }),
      [`${root}/Default/History`]: 'sqlite',
      [`${root}/Default/AccountBookmarks`]: '{"roots":{}}',
    })

    const profiles = scanProfiles({ home, platform: 'darwin', fs, vendors: ['brave'] })
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.stores.history).toBe(`${root}/Default/History`)
    expect(profiles[0]!.stores.bookmarks).toBeNull()
    expect(profiles[0]!.stores.cookies).toBeNull()
  })

  test('filters by vendor without dropping running profiles', () => {
    const home = '/users/me'
    const root = `${home}/.config/google-chrome`
    const fs = memoryFs({
      [`${root}/Local State`]: JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' } } } }),
      [`${root}/Default/History`]: 'sqlite',
      [`${root}/Default/SingletonLock`]: '',
    })

    const profiles = scanProfiles({ home, platform: 'linux', fs, vendors: ['chrome'] })
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.state).toBe('running')

    expect(scanProfiles({ home, platform: 'linux', fs, vendors: ['firefox'] })).toHaveLength(0)
  })

  test('defaults home to the real home directory', () => {
    const home = homedir()
    const root = `${home}/.config/google-chrome`
    const probed: string[] = []
    const files = new Map<string, string>([
      [`${root}/Local State`, JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' } } } })],
      [`${root}/Default/History`, 'sqlite'],
    ])
    const fs: ProfileFs = {
      exists: (path) => {
        probed.push(path)
        return [...files.keys()].some((key) => key === path || key.startsWith(`${path}/`))
      },
      readText: (path) => files.get(path) ?? null,
      writeText: (path, contents) => {
        files.set(path, contents)
      },
      remove: (path) => {
        files.delete(path)
      },
      listPaths: (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
    }

    const profiles = scanProfiles({ platform: 'linux', fs })
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.stores.history).toBe(`${root}/Default/History`)
    expect(probed.some((path) => path.startsWith(`${home}/.config`))).toBe(true)
  })
})