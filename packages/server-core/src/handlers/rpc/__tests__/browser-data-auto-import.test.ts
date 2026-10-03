import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

function scheduleFixture() {
  let nextId = 0
  const pending = new Map<number, { kind: 'first' | 'repeat'; run: () => void; delay: number }>()
  const add = (kind: 'first' | 'repeat', run: () => void, delay: number) => {
    const id = ++nextId
    pending.set(id, { kind, run, delay }); return id
  }
  const clear = (id: unknown) => { pending.delete(id as number) }
  return {
    clock: {
      setTimeout: ((run: () => void, delay: number) => add('first', run, delay)) as unknown as typeof setTimeout,
      setInterval: ((run: () => void, delay: number) => add('repeat', run, delay)) as unknown as typeof setInterval,
      clearTimeout: clear as typeof clearTimeout,
      clearInterval: clear as typeof clearInterval,
    },
    pending,
    fire(kind: 'first' | 'repeat') {
      for (const [id, task] of [...pending]) if (task.kind === kind) {
        if (kind === 'first') pending.delete(id)
        task.run()
      }
    },
  }
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

  it('keeps the original profile when another workspace switches profiles and resets counts for a changed profile', () => {
    const first = fixture(), second = fixture()
    const workspaces = new Map([
      ['first', { id: 'first', rootPath: first.rootPath }],
      ['second', { id: 'second', rootPath: second.rootPath }],
    ])
    const reads: { workspaceId: string; profileId: string }[] = []
    const importer = new BrowserDataAutoImporter({
      ...first.deps, workspace: id => workspaces.get(id) ?? null,
      importData: (workspace, profileId) => { reads.push({ workspaceId: workspace.id, profileId }); return { history: 4, bookmarks: 1 } },
    })
    importer.set('first', true, 'chromium:original')
    importer.set('second', true, 'firefox:separate')
    importer.run('first')
    expect(reads).toEqual([
      { workspaceId: 'first', profileId: 'chromium:original' },
      { workspaceId: 'second', profileId: 'firefox:separate' },
      { workspaceId: 'first', profileId: 'chromium:original' },
    ])
    first.preferences([])
    expect(importer.set('first', true, 'chromium:new')).toMatchObject({ profileId: 'chromium:new', imported: { history: 0, bookmarks: 0 }, lastRunAt: null })
    expect(reads).toHaveLength(3)
    expect(importer.status('second').profileId).toBe('firefox:separate')
    if (process.platform !== 'win32') expect(statSync(join(first.rootPath, '.rox/browser-data-auto-import.json')).mode & 0o777).toBe(0o600)
  })

  it('does not read a profile during a manual native permission request and retries after the request completes', () => {
    const f = fixture()
    let pending = true
    const importer = new BrowserDataAutoImporter({ ...f.deps, isBusy: id => id === 'workspace' && pending })
    expect(importer.set('workspace', true, 'chromium:selected').state).toBe('idle')
    importer.run('workspace'); expect(f.calls).toHaveLength(0)
    pending = false
    expect(importer.run('workspace').state).toBe('done'); expect(f.calls).toHaveLength(1)
    pending = true
    importer.set('workspace', false)
    pending = false
    importer.run('workspace'); expect(f.calls).toHaveLength(1)
  })

  it('isolates a failing workspace, notices newly created authorized workspaces, and prunes removed workspaces', () => {
    const first = fixture(), second = fixture(), third = fixture(), timer = scheduleFixture()
    const workspaces = new Map([
      ['first', { id: 'first', rootPath: first.rootPath }],
      ['second', { id: 'second', rootPath: second.rootPath }],
    ])
    const reads: string[] = []
    let failing = false
    const importer = new BrowserDataAutoImporter({
      ...first.deps, workspace: id => workspaces.get(id) ?? null, workspaceIds: () => [...workspaces.keys()],
      importData: workspace => {
        reads.push(workspace.id)
        if (failing && workspace.id === 'first') throw Error('private source detail')
        return { history: 1, bookmarks: 2 }
      },
    }, timer.clock)
    importer.set('first', true, 'chromium:first'); importer.set('second', true, 'firefox:second')
    reads.length = 0; failing = true
    importer.start(['first', 'second']); timer.fire('first')
    expect(reads).toEqual(['first', 'second']); expect(importer.status('first').error).toBe('browser-data-read-failed')
    expect(importer.status('second').state).toBe('done')
    workspaces.delete('first')
    workspaces.set('third', { id: 'third', rootPath: third.rootPath })
    // Recreate persisted authorization from a prior host lifetime, without querying its status on this host.
    new BrowserDataAutoImporter({ ...third.deps }).set('workspace', true, 'safari:third')
    reads.length = 0; timer.fire('repeat')
    expect(reads).toEqual(['second', 'third']); expect(importer.status('first').workspaceId).toBeNull()
    expect(existsSync(join(third.rootPath, '.rox/browser-data-auto-import.json'))).toBe(true)
    reads.length = 0; timer.fire('repeat'); expect(reads).toEqual(['second', 'third'])
    importer.stop()
  })

  it('continues the scheduled pass when saving one workspace fails and releases its running guard', () => {
    const first = fixture(), second = fixture(), timer = scheduleFixture()
    const reads: string[] = []
    let failState = false
    const workspaceFor = (id: string) => id === 'first' ? { id, rootPath: first.rootPath } : { id, rootPath: second.rootPath }
    const importer = new BrowserDataAutoImporter({
      ...first.deps, workspace: workspaceFor,
      importData: workspace => {
        reads.push(workspace.id)
        if (workspace.id === 'first' && failState) {
          const path = join(first.rootPath, '.rox/browser-data-auto-import.json')
          rmSync(path); mkdirSync(path)
        }
        return { history: 1, bookmarks: 0 }
      },
    }, timer.clock)
    importer.set('first', true, 'chromium:first'); importer.set('second', true, 'chromium:second')
    reads.length = 0; failState = true
    importer.start(['first', 'second']); timer.fire('first')
    expect(reads).toEqual(['first', 'second'])
    expect(importer.status('first').error).toBe('browser-data-read-failed')
    failState = false
    rmSync(join(first.rootPath, '.rox/browser-data-auto-import.json'), { recursive: true })
    expect(importer.set('first', true, 'chromium:first').state).toBe('done')
    expect(reads).toEqual(['first', 'second', 'first'])
    importer.stop()
  })

  it('starts one schedule, retains additional workspace registrations, and cancels every timer on shutdown', () => {
    const f = fixture(), timer = scheduleFixture()
    const importer = new BrowserDataAutoImporter(f.deps, timer.clock)
    importer.set('workspace', true, 'chromium:selected'); f.calls.length = 0
    importer.start([]); importer.start(['workspace']); importer.start(['missing'])
    expect([...timer.pending.values()].map(task => task.delay)).toEqual([25_000, 15 * 60_000])
    timer.fire('first'); expect(f.calls).toHaveLength(1)
    importer.stop(); importer.stop(); expect(timer.pending.size).toBe(0)
    timer.fire('repeat'); expect(f.calls).toHaveLength(1)
    importer.start([]); expect(timer.pending.size).toBe(2)
    timer.fire('first'); expect(f.calls).toHaveLength(2)
    importer.stop()
  })

  it('rejects malformed persisted profile authorization without source reads', () => {
    const f = fixture()
    mkdirSync(join(f.rootPath, '.rox'))
    writeFileSync(join(f.rootPath, '.rox/browser-data-auto-import.json'), JSON.stringify({ enabled: true, profileId: 'chromium:selected\nfirefox:another', imported: { history: -2, bookmarks: -1 }, error: 'Sensitive source detail' }))
    const importer = new BrowserDataAutoImporter(f.deps)
    expect(importer.run('workspace')).toMatchObject({ enabled: false, profileId: null, imported: { history: 0, bookmarks: 0 } })
    expect(importer.status('workspace').error).toBeUndefined(); expect(f.calls).toHaveLength(0)
    expect(() => importer.set('workspace', true, 'chromium:selected\0extra')).toThrow('browser-profile-unavailable')
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
