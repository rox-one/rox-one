import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserDataAutoImporter } from '../browser-data-auto-import'
import type { BrowserImportCategory } from '@craft-agent/shared/environment'
import { importProfile, type ProfileFs } from '@craft-agent/shared/browser/profile-import'
import { readNativeBrowserData } from '@craft-agent/shared/browser/profile-native-data'
import { DatabaseSync } from '@craft-agent/shared/utils/sqlite-runtime'
import { WsRpcServer } from '@craft-agent/server-core/transport'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const rootPath = mkdtempSync(join(tmpdir(), 'rox-data-auto-fixture-'))
  roots.push(rootPath)
  let categories: BrowserImportCategory[] = ['history', 'bookmarks', 'cookies', 'credentials']
  const calls: { profileId: string; categories: { history: boolean; bookmarks: boolean } }[] = []
  const deps = {
    workspace: (id: string) => id === 'workspace' ? { id, rootPath } : null,
    preferences: () => categories,
    importData: (_workspace: unknown, profileId: string, selected: { history: boolean; bookmarks: boolean }) => {
      calls.push({ profileId, categories: selected }); return { history: selected.history ? 3 : 0, bookmarks: selected.bookmarks ? 2 : 0 }
    },
  }
  return { rootPath, calls, deps, preferences: (next: BrowserImportCategory[]) => { categories = next } }
}

describe('automatic browser history and bookmark import', () => {
  it('does not read profiles before explicit per-profile consent, and preserves consent across restart', () => {
    const f = fixture(), importer = new BrowserDataAutoImporter(f.deps)
    expect(importer.status('workspace').enabled).toBe(false)
    importer.run('workspace'); expect(f.calls).toHaveLength(0)
    const enabled = importer.set('workspace', true, 'firefox:selected')
    expect(enabled.imported).toEqual({ history: 3, bookmarks: 2 })
    expect(f.calls).toEqual([{ profileId: 'firefox:selected', categories: { history: true, bookmarks: true } }])
    const restarted = new BrowserDataAutoImporter(f.deps)
    expect(restarted.status('workspace').enabled).toBe(true)
    expect(f.calls).toHaveLength(1) // Status never reads source data.
    restarted.run('workspace'); expect(f.calls).toHaveLength(2)
    restarted.set('workspace', false); restarted.run('workspace')
    expect(f.calls).toHaveLength(2)
  })

  it('rechecks preferences for every run and cannot request cookies or credentials', () => {
    const f = fixture(), importer = new BrowserDataAutoImporter(f.deps)
    f.preferences(['bookmarks', 'cookies', 'credentials'])
    importer.set('workspace', true, 'chromium:selected')
    expect(f.calls[0]?.categories).toEqual({ history: false, bookmarks: true })
    f.preferences([]); importer.run('workspace'); expect(f.calls).toHaveLength(1)
    f.preferences(['history']); importer.run('workspace')
    expect(f.calls[1]?.categories).toEqual({ history: true, bookmarks: false })
  })

  it('fails closed for corrupt saved state and redacts source errors', () => {
    const f = fixture()
    mkdirSync(join(f.rootPath, '.rox'))
    writeFileSync(join(f.rootPath, '.rox', 'browser-data-auto-import.json'), 'corrupt fixture')
    const importer = new BrowserDataAutoImporter({ ...f.deps, importData: () => { throw new Error('Sensitive fixture URL/password') } })
    importer.run('workspace'); expect(f.calls).toHaveLength(0)
    expect(importer.set('workspace', true, 'safari:selected').error).toBe('browser-data-read-failed')
    expect(readFileSync(join(f.rootPath, '.rox', 'browser-data-auto-import.json'), 'utf8')).not.toContain('Sensitive')
    expect(() => importer.set('workspace', true, '/arbitrary/path')).toThrow('browser-profile-unavailable')
  })

  it('persists real native fixture rows through the scheduled importer without secret reads or duplicate rollback files', () => {
    const f = fixture(), profilePath = join(f.rootPath, 'synthetic-profile')
    mkdirSync(profilePath)
    const database = new DatabaseSync(join(profilePath, 'History'))
    database.exec("CREATE TABLE urls(url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER); INSERT INTO urls VALUES('https://fixture.example','Native fixture',1,1);")
    database.close()
    writeFileSync(join(profilePath, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Fixture bookmark', url: 'https://bookmark.example' }] } } }))
    const fs: ProfileFs = {
      exists: existsSync, readText: (path) => existsSync(path) ? readFileSync(path, 'utf8') : null,
      writeText: (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) },
      remove: (path) => rmSync(path, { force: true }), listPaths: () => [],
    }
    const indexPath = join(f.rootPath, 'browser', 'profile-index.json')
    const importer = new BrowserDataAutoImporter({ ...f.deps, importData: (_workspace, profileId, selected) => {
      const summary = importProfile({
        profile: { id: profileId, path: profilePath, family: 'chromium', name: 'Synthetic', lastUsedAt: null, recommended: false, state: 'ok' },
        consent: { historyBookmarks: true, ...selected, cookies: false, credentials: false, osCredentialsApproved: false },
        authorizedScopes: { cookies: false, credentials: false }, nativeData: readNativeBrowserData,
        fs, indexPath, vaultPath: join(f.rootPath, 'browser', 'unused-secret-vault.json'), dryRun: false, retainRollback: false,
      })
      expect(summary.accessedStores).toEqual(['history_bookmarks'])
      expect(summary.rollbackToken).toBeNull()
      return { history: summary.counts.history, bookmarks: summary.counts.bookmarks }
    } })
    expect(importer.set('workspace', true, 'chromium:synthetic').imported).toEqual({ history: 1, bookmarks: 1 })
    importer.run('workspace')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    expect(index.history[0].url).toBe('https://fixture.example')
    expect(index.bookmarks[0].url).toBe('https://bookmark.example')
    expect(readdirSync(dirname(indexPath))).toEqual(['profile-index.json'])
  })

  it('disposes host-owned background schedules when the transport closes', () => {
    const server = new WsRpcServer(), importer = new BrowserDataAutoImporter(fixture().deps)
    importer.start(['workspace'])
    let disposed = 0
    server.onShutdown(() => { importer.stop(); disposed++ })
    const unregister = server.onShutdown(() => { throw new Error('Removed hook should not run') })
    unregister(); server.close(); server.close()
    expect(disposed).toBe(1)
  })
})
