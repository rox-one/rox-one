import { describe, expect, it } from 'bun:test'
import {
  canAccessCredentials,
  deleteImportedProfile,
  discoverBrowserProfiles,
  importProfile,
  isSecretStorePath,
  parseBookmarks,
  parseHistory,
  recommendProfile,
  rollbackImport,
  summaryLeaksSecrets,
  type ProfileFs,
} from '../profile-import.ts'

const NOW = Date.parse('2026-09-12T18:00:00Z')
const TODAY = NOW - 60 * 60 * 1000
const LAST_YEAR = NOW - 40 * 24 * 60 * 60 * 1000
const COOKIE_SECRET = 'cookie-secret-value-DO-NOT-LEAK'
const PASSWORD_SECRET = 'hunter2-password-DO-NOT-LEAK'

function memoryFs(seed: Record<string, string | null> = {}): ProfileFs & { reads: string[]; files: Map<string, string> } {
  const files = new Map<string, string>()
  for (const [path, value] of Object.entries(seed)) {
    if (value !== null) files.set(path, value)
  }
  const reads: string[] = []
  return {
    files,
    reads,
    exists(path) {
      return [...files.keys()].some((key) => key === path || key.startsWith(`${path}/`))
    },
    readText(path) {
      reads.push(path)
      return files.get(path) ?? null
    },
    writeText(path, contents) {
      files.set(path, contents)
    },
    remove(path) {
      files.delete(path)
    },
  }
}

const chromeRoot = '/home/user/.config/google-chrome'
const defaultPath = `${chromeRoot}/Default`

function chromeSeed(): Record<string, string> {
  return {
    [`${chromeRoot}/Local State`]: JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Work', active_time: TODAY },
          Profile: { name: 'Old', active_time: LAST_YEAR },
        },
      },
    }),
    [`${defaultPath}/Bookmarks`]: JSON.stringify({
      roots: {
        bookmark_bar: {
          children: [
            { type: 'url', url: 'https://docs.rox', name: 'Rox docs' },
            { type: 'url', url: 'https://docs.rox', name: 'Rox docs dup' },
          ],
        },
      },
    }),
    [`${defaultPath}/history.json`]: JSON.stringify({
      visits: [
        { url: 'https://docs.rox', title: 'Rox docs' },
        { url: 'https://news.example', title: 'News' },
      ],
    }),
    [`${defaultPath}/Cookies`]: `host\tTRUE\t/\tFALSE\t0\tsid\t${COOKIE_SECRET}`,
    [`${defaultPath}/logins.json`]: JSON.stringify({
      logins: [{ hostname: 'https://example.com', password: PASSWORD_SECRET }],
    }),
    [`${chromeRoot}/Profile/Bookmarks`]: '{not-json',
    [`${chromeRoot}/Profile/lock`]: '',
  }
}

describe('Issue 15 privileged profile import', () => {
  it('discovers Safari/Chromium/Firefox paths without reading secret stores', () => {
    const linuxFs = memoryFs({
      ...chromeSeed(),
      '/home/user/.mozilla/firefox/profiles.ini': '[Profile0]\nName=main\nIsRelative=1\nPath=abc.default\n',
      '/home/user/.mozilla/firefox/abc.default/places.sqlite': 'sqlite',
    })
    const linux = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'linux',
      now: NOW,
      fs: linuxFs,
      explicitId: `chromium:${defaultPath}`,
    })
    const safariFs = memoryFs({
      '/home/user/Library/Safari/Bookmarks.plist': 'plist',
    })
    const darwin = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'darwin',
      now: NOW,
      fs: safariFs,
    })
    expect(linux.some((profile) => profile.family === 'chromium' && profile.recommended)).toBe(true)
    expect(linux.some((profile) => profile.family === 'firefox')).toBe(true)
    expect(darwin.some((profile) => profile.family === 'safari')).toBe(true)
    expect(linuxFs.reads.some((path) => isSecretStorePath(path))).toBe(false)
    expect(safariFs.reads.some((path) => isSecretStorePath(path))).toBe(false)
  })

  it('recommends an explicit source, then the most recently used profile that day', () => {
    const profiles = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'linux',
      now: NOW,
      fs: memoryFs(chromeSeed()),
    })
    const today = recommendProfile(profiles, undefined, NOW)
    expect(today?.name).toBe('Work')
    expect(recommendProfile(profiles, `chromium:${chromeRoot}/Profile`)?.name).toBe('Old')
  })

  it('imports bookmarks/history and declines cookies/passwords without touching credential stores', () => {
    const fs = memoryFs(chromeSeed())
    const profile = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'linux',
      now: NOW,
      fs,
    }).find((item) => item.path === defaultPath)!
    fs.reads.length = 0
    const summary = importProfile({
      profile,
      consent: {
        historyBookmarks: true,
        cookies: false,
        credentials: false,
        osCredentialsApproved: false,
      },
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      dryRun: false,
    })
    expect(summary.counts.bookmarks).toBe(1)
    expect(summary.counts.history).toBe(2)
    expect(summary.counts.cookies).toBe(0)
    expect(summary.counts.credentials).toBe(0)
    expect(summary.accessedStores).toEqual(['history_bookmarks'])
    expect(fs.reads.some((path) => isSecretStorePath(path))).toBe(false)
    expect(canAccessCredentials({
      historyBookmarks: true,
      cookies: false,
      credentials: true,
      osCredentialsApproved: false,
    })).toBe(false)
    expect(summaryLeaksSecrets(summary, [COOKIE_SECRET, PASSWORD_SECRET])).toBe(false)
  })

  it('does not read Login Data when cookies are selected and credentials are declined', () => {
    const seed = chromeSeed()
    delete seed[`${defaultPath}/Cookies`]
    const fs = memoryFs(seed)
    const profile = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'linux',
      fs,
    }).find((item) => item.path === defaultPath)!
    fs.reads.length = 0
    importProfile({
      profile,
      consent: {
        historyBookmarks: false,
        cookies: true,
        credentials: true,
        osCredentialsApproved: false,
      },
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      dryRun: true,
    })
    expect(fs.reads.some((path) => path.endsWith('Login Data') || path.endsWith('logins.json'))).toBe(false)
  })

  it('seals cookies into an encrypted partition and never returns secret values', () => {
    const fs = memoryFs(chromeSeed())
    const profile = discoverBrowserProfiles({
      home: '/home/user',
      platform: 'linux',
      fs,
    }).find((item) => item.path === defaultPath)!
    const summary = importProfile({
      profile,
      consent: {
        historyBookmarks: false,
        cookies: true,
        credentials: true,
        osCredentialsApproved: true,
      },
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      dryRun: false,
    })
    expect(summary.accessedStores).toContain('cookies')
    expect(summary.accessedStores).toContain('credentials')
    expect(summary.counts.cookies).toBeGreaterThan(0)
    expect(summary.counts.credentials).toBe(1)
    const vault = fs.files.get('/ws/cookie-vault.json') ?? ''
    expect(vault).toContain('aes-256-gcm')
    expect(vault.includes(COOKIE_SECRET)).toBe(false)
    expect(summaryLeaksSecrets(summary, [COOKIE_SECRET, PASSWORD_SECRET])).toBe(false)
  })

  it('supports dry run, rollback, deletion receipts, and locked/corrupt/running states', () => {
    const fs = memoryFs({
      ...chromeSeed(),
      '/home/user/.config/chromium/Local State': '{',
      '/home/user/.config/microsoft-edge/Default/lock': '',
    })
    const profiles = discoverBrowserProfiles({ home: '/home/user', platform: 'linux', fs })
    expect(profiles.some((profile) => profile.state === 'corrupt')).toBe(true)
    expect(profiles.some((profile) => profile.state === 'running')).toBe(true)

    const work = profiles.find((profile) => profile.path === defaultPath)!
    const dry = importProfile({
      profile: work,
      consent: {
        historyBookmarks: true,
        cookies: false,
        credentials: false,
        osCredentialsApproved: false,
      },
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      dryRun: true,
    })
    expect(dry.dryRun).toBe(true)
    expect(dry.rollbackToken).toBeNull()
    expect(fs.files.has('/ws/browser-index.json')).toBe(false)

    fs.writeText('/ws/browser-index.json', JSON.stringify({
      bookmarks: [{ kind: 'bookmark', url: 'https://kept.example', title: 'Kept' }],
      history: [],
    }))
    const first = importProfile({
      profile: work,
      consent: {
        historyBookmarks: true,
        cookies: false,
        credentials: false,
        osCredentialsApproved: false,
      },
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      dryRun: false,
      now: 1000,
    })
    const imported = JSON.parse(fs.files.get('/ws/browser-index.json')!) as { bookmarks: Array<{ url: string }> }
    expect(imported.bookmarks.some((item) => item.url === 'https://docs.rox')).toBe(true)
    expect(rollbackImport(fs, '/ws/browser-index.json', first.rollbackToken!)).toBe(true)
    const restored = JSON.parse(fs.files.get('/ws/browser-index.json')!) as { bookmarks: Array<{ url: string }> }
    expect(restored.bookmarks[0]?.url).toBe('https://kept.example')

    const deleted = deleteImportedProfile({
      fs,
      indexPath: '/ws/browser-index.json',
      vaultPath: '/ws/cookie-vault.json',
      now: 2000,
    })
    expect(deleted.deletionReceipt.itemCount).toBeGreaterThan(0)
    expect(deleted.deletionReceipt.categories).toContain('history_bookmarks')
  })

  it('parses Netscape and Chrome bookmark fixtures', () => {
    const html = parseBookmarks('<DT><A HREF="https://a.example">Alpha</A>')
    expect(html).toEqual([{ kind: 'bookmark', url: 'https://a.example', title: 'Alpha' }])
    expect(parseHistory('{"visits":[{"url":"https://b.example","title":"B"}]}')).toEqual([
      { kind: 'history', url: 'https://b.example', title: 'B' },
    ])
  })
})
