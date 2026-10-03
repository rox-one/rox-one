import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { BrowserCredentialHost, BrowserCredentialAccess } from '@rox/shared/browser/browser-credential-host'
import type { BrowserImportCategory } from '@rox/shared/environment'
import type { BrowserDataAutoStatus, ImportSummary } from '@rox/shared/browser/profile-import'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerBrowserProfileImportHandlers } from '../browser-profile-import'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-auto-import-rpc-'))
  roots.push(root)
  const home = join(root, 'home'), workspace = join(root, 'workspace')
  const profilePath = join(home, '.config/google-chrome/Default')
  mkdirSync(profilePath, { recursive: true }); mkdirSync(workspace)
  const history = new DatabaseSync(join(profilePath, 'History'))
  history.exec("CREATE TABLE urls(url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER); INSERT INTO urls VALUES('https://fixture.example','History fixture',1,1);")
  history.close()
  writeFileSync(join(profilePath, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Bookmark fixture', url: 'https://bookmark.example' }] } } }))
  const profileId = `chromium:${profilePath}`
  const indexPath = join(workspace, 'browser/profile-index.json')
  let categories: BrowserImportCategory[] = ['history', 'bookmarks', 'cookies', 'credentials']
  let requests = 0
  let resolveAccess!: (result: BrowserCredentialAccess) => void
  const access = new Promise<BrowserCredentialAccess>(resolve => { resolveAccess = resolve })
  const host: BrowserCredentialHost = {
    capabilities: () => ({ supported: true, mechanism: 'linux-secret-service' }),
    requestAccess: async () => { requests++; return access },
    vaultKeys: { available: () => true, storeKey: () => { throw Error('No key custody during automatic import') }, deleteKey: () => true },
  }
  const handlers = new Map<string, HandlerFn>()
  const server = { handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer
  const register = () => registerBrowserProfileImportHandlers(server, { browserCredentials: host } as HandlerDeps, {
    home, platform: 'linux', workspaceFor: id => id === 'workspace' ? { id, rootPath: workspace } : null,
    browserImportCategories: () => categories,
  })
  register()
  const context: RequestContext = { clientId: 'desktop-fixture', workspaceId: 'workspace', webContentsId: 41 }
  const invoke = (channel: string, args: unknown) => handlers.get(channel)!(context, args)
  const automatic = (action: 'status' | 'set' | 'run', enabled?: boolean) => invoke(RPC_CHANNELS.browserProfile.DATA_AUTO_IMPORT, { workspaceId: 'workspace', action, enabled, profileId }) as BrowserDataAutoStatus
  return { root, workspace, profilePath, profileId, indexPath, invoke, automatic, register, get requests() { return requests },
    preferences(next: BrowserImportCategory[]) { categories = next },
    cancel() { resolveAccess({ status: 'cancelled', reason: 'browser-credential-access-cancelled' }) },
  }
}

describe('automatic browser import RPC lifecycle', () => {
  it('retains the manual import guard when handlers are registered again on the same transport', async () => {
    const f = fixture()
    const args = { workspaceId: 'workspace', profileId: f.profileId,
      consent: { historyBookmarks: false, cookies: false, credentials: true, osCredentialsApproved: true } }
    const manual = Promise.resolve(f.invoke(RPC_CHANNELS.browserProfile.IMPORT, args)) as Promise<ImportSummary>
    f.register()
    expect(f.automatic('set', true).state).toBe('idle')
    await expect(Promise.resolve(f.invoke(RPC_CHANNELS.browserProfile.IMPORT, args))).rejects.toThrow('browser-profile-import-pending')
    expect(existsSync(f.indexPath)).toBe(false); expect(f.requests).toBe(1)
    f.cancel(); await manual
    expect(f.automatic('run').imported).toEqual({ history: 1, bookmarks: 1 })
    expect(f.requests).toBe(1)
  })

  it('defers profile reads while a manual password prompt is pending, including immediate enable and run actions', async () => {
    const f = fixture()
    const manual = Promise.resolve(f.invoke(RPC_CHANNELS.browserProfile.IMPORT, {
      workspaceId: 'workspace', profileId: f.profileId,
      consent: { historyBookmarks: false, history: false, bookmarks: false, cookies: false, credentials: true, osCredentialsApproved: true },
    })) as Promise<ImportSummary>
    expect(f.requests).toBe(1)
    expect(f.automatic('set', true)).toMatchObject({ enabled: true, state: 'idle' })
    f.automatic('run'); expect(existsSync(f.indexPath)).toBe(false)
    expect(() => f.invoke(RPC_CHANNELS.browserProfile.ROLLBACK, { workspaceId: 'workspace', token: 'rb-fixture' })).toThrow('browser-profile-import-pending')
    expect(() => f.invoke(RPC_CHANNELS.browserProfile.DELETE, 'workspace')).toThrow('browser-profile-import-pending')
    f.cancel(); expect((await manual).credentialAccess).toBe('cancelled')
    expect(f.automatic('run')).toMatchObject({ enabled: true, state: 'done', imported: { history: 1, bookmarks: 1 } })
    expect(f.requests).toBe(1)
    expect(JSON.parse(readFileSync(f.indexPath, 'utf8')).history).toHaveLength(1)
    expect(existsSync(join(f.workspace, 'browser/credential-vault.json'))).toBe(false)
  })

  it('turns off the schedule on rollback and deletion and never reimports after either action', () => {
    const f = fixture()
    expect(f.automatic('set', true).imported).toEqual({ history: 1, bookmarks: 1 })
    // A stale rollback token still revokes recurring source access.
    expect(f.invoke(RPC_CHANNELS.browserProfile.ROLLBACK, { workspaceId: 'workspace', token: 'rb-nonexistent' })).toEqual({ ok: false })
    expect(f.automatic('run').enabled).toBe(false)
    expect(f.automatic('set', true).enabled).toBe(true)
    f.invoke(RPC_CHANNELS.browserProfile.DELETE, 'workspace')
    expect(existsSync(f.indexPath)).toBe(false)
    expect(f.automatic('run').enabled).toBe(false)
    expect(existsSync(f.indexPath)).toBe(false)
    expect(f.requests).toBe(0)
  })

  it('rechecks category opt-outs on actual native SQLite reads without opening native password access', () => {
    const f = fixture()
    f.preferences(['credentials', 'cookies'])
    expect(f.automatic('set', true).state).toBe('idle')
    expect(existsSync(f.indexPath)).toBe(false); expect(f.requests).toBe(0)
    f.preferences(['bookmarks', 'credentials'])
    expect(f.automatic('run').imported).toEqual({ history: 0, bookmarks: 1 })
    const index = JSON.parse(readFileSync(f.indexPath, 'utf8'))
    expect(index.history).toHaveLength(0); expect(index.bookmarks).toHaveLength(1); expect(f.requests).toBe(0)
  })
})
