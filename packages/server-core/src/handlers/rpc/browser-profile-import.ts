/**
 * Issue 15 RPC: privileged browser profile import.
 * Cookie/credential bytes never leave this process in the RPC result.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { readNativeBrowserData } from '@rox/shared/browser/profile-native-data'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@rox/shared/config'
import { loadEnvironmentPrefs, type BrowserImportCategory } from '@rox/shared/environment'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import {
  deleteImportedProfile,
  discoverBrowserProfileById,
  discoverBrowserProfiles,
  importProfile,
  rollbackImport,
  type ImportConsent,
  type ProfileFs,
  type ProtectedCookieImport,
} from '@rox/shared/browser/profile-import'
import {
  loadPrivacyState,
  providerScopeAllowed,
  setProviderAccessConsent,
} from '@rox/shared/privacy'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { deleteProtectedCookieKey } from './browser-protected-cookie-key'
import { BrowserDataAutoImporter } from './browser-data-auto-import'
import { prepareBrowserCredentialImport } from './browser-credential-vault'
import {
  isClaimableLive,
  rpcBrowserProfileImportActResult,
  rpcBrowserProfileImportListResult,
  rpcBrowserProfileImportReadResult,
} from '@rox/core/rox2'

export const BROWSER_PROFILE_CHANNELS = [
  RPC_CHANNELS.browserProfile.DISCOVER,
  RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES,
  RPC_CHANNELS.browserProfile.IMPORT,
  RPC_CHANNELS.browserProfile.ROLLBACK,
  RPC_CHANNELS.browserProfile.DELETE,
  RPC_CHANNELS.browserProfile.DATA_AUTO_IMPORT,
] as const

function nodeFs(): ProfileFs {
  return {
    exists: (path) => existsSync(path),
    readText: (path) => {
      if (!existsSync(path)) return null
      return readFileSync(path, 'utf8')
    },
    writeText: (path, contents) => {
      mkdirSync(dirname(path), { recursive: true })
      atomicWriteFileSync(path, contents, { durable: true })
      chmodSync(path, 0o600)
    },
    listPaths: (prefix) => existsSync(dirname(prefix)) ? readdirSync(dirname(prefix)).map(name => join(dirname(prefix), name)).filter(path => path.startsWith(prefix)) : [],
    remove: (path) => {
      if (existsSync(path)) rmSync(path)
    },
  }
}

function pathsFor(workspaceId: string, workspaceFor = getWorkspaceByNameOrId as (id: string) => { id: string; rootPath: string } | null): { root: string; indexPath: string; vaultPath: string; credentialVaultPath: string } | null {
  const workspace = workspaceFor(workspaceId)
  if (!workspace) return null
  const dir = join(workspace.rootPath, 'browser')
  return {
    root: workspace.rootPath,
    indexPath: join(dir, 'profile-index.json'),
    vaultPath: join(dir, 'cookie-vault.json'),
    credentialVaultPath: join(dir, 'credential-vault.json'),
  }
}

const COOKIE_PROVIDER = 'browser-profile-cookies'
const PROFILE_IMPORT_PURPOSE = 'browser-profile-import'

function consentAccountRef(profileId: string): string {
  return createHash('sha256').update(profileId).digest('hex')
}

function exactDomains(domains: readonly string[]): string[] {
  const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))]
  if (
    normalized.length === 0 ||
    normalized.some((domain) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain))
  ) {
    throw new Error('Choose exact domains before importing cookies')
  }
  return normalized
}

function storeProtectedCookieKey(reference: string, key: Buffer): boolean {
  const service = 'rox.browser-profile-cookie-vault'
  const password = key.toString('hex')
  try {
    if (process.platform === 'darwin') {
      execFileSync('security', ['add-generic-password', '-U', '-s', service, '-a', reference, '-w', password], { stdio: 'ignore' })
      return true
    }
    if (process.platform === 'linux') {
      return spawnSync('secret-tool', ['store', '--label=Rox browser cookie vault', 'service', service, 'account', reference], {
        input: password,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
      }).status === 0
    }
  } catch {
    return false
  }
  return false
}

function cookieVaultRef(workspaceId: string, profileId: string): string {
  return createHash('sha256').update(`${workspaceId}\0${profileId}`).digest('hex')
}

function protectedCookieAccess(workspaceId: string, profileId: string): ProtectedCookieImport {
  const reference = `${cookieVaultRef(workspaceId, profileId)}-${randomUUID()}`
  return {
    read(profile, domains) {
      if (profile.family !== 'chromium' || domains.length === 0) throw new Error('scoped-cookie-store-unsupported')
      const candidates = [join(profile.path, 'Network', 'Cookies'), join(profile.path, 'Cookies')]
      const cookiePath = candidates.find((path) => existsSync(path))
      if (!cookiePath) return null
      const database = new DatabaseSync(cookiePath, { readOnly: true })
      try {
        const placeholders = domains.map(() => '?').join(', ')
        const rows = database.prepare(
          `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE lower(ltrim(host_key, '.')) IN (${placeholders})`,
        ).all(...domains)
        return JSON.stringify(rows)
      } catch {
        throw new Error('scoped-cookie-store-read-failed')
      } finally {
        database.close()
      }
    },
    storeKey(key) {
      return storeProtectedCookieKey(reference, key) ? reference : null
    },
    deleteKey: deleteProtectedCookieKey,
  }
}

const importers = new WeakMap<RpcServer, BrowserDataAutoImporter>()
const pendingImports = new WeakMap<RpcServer, Set<string>>()

export interface BrowserProfileImportRuntime {
  home?: string
  platform?: NodeJS.Platform
  fs?: ProfileFs
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
  browserImportCategories?: () => readonly BrowserImportCategory[]
}

export function registerBrowserProfileImportHandlers(server: RpcServer, deps: HandlerDeps, runtime: BrowserProfileImportRuntime = {}): void {
  const fs = runtime.fs ?? nodeFs()
  const home = runtime.home ?? homedir()
  const platform = runtime.platform ?? process.platform
  const workspaceFor = runtime.workspaceFor ?? getWorkspaceByNameOrId
  const pathsForWorkspace = (id: string) => pathsFor(id, workspaceFor)
  const importsInFlight = pendingImports.get(server) ?? new Set<string>()
  pendingImports.set(server, importsInFlight)
  importers.get(server)?.stop()
  const autoImporter = new BrowserDataAutoImporter({
    workspace: workspaceFor,
    workspaceIds: () => getWorkspaces().map((workspace) => workspace.id),
    isBusy: (workspaceId) => importsInFlight.has(workspaceId),
    preferences: runtime.browserImportCategories ?? (() => loadEnvironmentPrefs().browserImport.value ?? []),
    importData(workspace, profileId, categories) {
      const act = rpcBrowserProfileImportActResult({ source: 'native', action: 'write', nativeId: profileId })
      if (!isClaimableLive(act)) throw new Error('browser-profile-unavailable')
      const profile = discoverBrowserProfileById({ home, platform, fs, profileId })
      if (!profile || profile.state === 'locked' || profile.state === 'unsupported') throw new Error('browser-profile-unavailable')
      const paths = pathsForWorkspace(workspace.id)
      if (!paths) throw new Error('browser-workspace-unavailable')
      const result = importProfile({
        profile, fs, indexPath: paths.indexPath, vaultPath: paths.vaultPath,
        consent: { historyBookmarks: true, ...categories, cookies: false, credentials: false, osCredentialsApproved: false },
        authorizedScopes: { cookies: false, credentials: false }, nativeData: readNativeBrowserData,
        dryRun: false, retainRollback: false,
      })
      return { history: result.counts.history, bookmarks: result.counts.bookmarks }
    },
  })
  importers.set(server, autoImporter)
  server.onShutdown?.(() => autoImporter.stop())
  // Source reads resume only for previously authorized profiles in the desktop host.
  if (process.versions.electron && process.env.NODE_ENV !== 'test') autoImporter.start(getWorkspaces().map((workspace) => workspace.id))

  server.handle(RPC_CHANNELS.browserProfile.DATA_AUTO_IMPORT, (_ctx, args: { workspaceId: string; action: 'status' | 'set' | 'run'; enabled?: boolean; profileId?: string }) => {
    if (!args || typeof args.workspaceId !== 'string') throw new Error('browser-workspace-unavailable')
    if (args.action === 'status') return autoImporter.status(args.workspaceId)
    const act = rpcBrowserProfileImportActResult({ source: 'native', action: 'write', nativeId: args.profileId ?? args.workspaceId })
    if (!isClaimableLive(act)) throw new Error('browser-profile-unavailable')
    if (args.action === 'set') return autoImporter.set(args.workspaceId, args.enabled === true, args.profileId)
    if (args.action === 'run') return autoImporter.run(args.workspaceId)
    throw new Error('browser-import-action-invalid')
  })

  server.handle(RPC_CHANNELS.browserProfile.DISCOVER, (_ctx, args?: { consent?: boolean; explicitId?: string }) => {
    if (args?.consent !== true) return []
    const explicitId = args.explicitId
    const listed = rpcBrowserProfileImportListResult({
      source: 'native',
      nativeIds: explicitId ? [explicitId] : [],
    })
    if (!isClaimableLive(listed.result)) return []
    return discoverBrowserProfiles({
      home,
      platform,
      fs,
      explicitId,
    })
  })

  server.handle(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES, (ctx, args: { workspaceId: string; profileId: string }) => {
    if (!args || !pathsForWorkspace(args.workspaceId) || !deps.browserCredentials || ctx.webContentsId == null || ctx.workspaceId !== args.workspaceId) {
      return { supported: false, mechanism: null, reason: 'browser-credential-native-service-unavailable' }
    }
    const profile = discoverBrowserProfileById({ home, platform, fs, profileId: args.profileId })
    if (!profile || profile.state === 'locked' || profile.state === 'unsupported') {
      return { supported: false, mechanism: null, reason: 'browser-profile-unavailable' }
    }
    const capability = deps.browserCredentials.capabilities(profile)
    return deps.browserCredentials.vaultKeys.available() ? capability : { ...capability, supported: false, reason: 'browser-credential-vault-unavailable' }
  })

  server.handle(
    RPC_CHANNELS.browserProfile.IMPORT,
    async (ctx, args: { workspaceId: string; profileId: string; consent: ImportConsent; dryRun?: boolean }) => {
      // An RPC boolean cannot attest to OS authorization. Only the injected
      // native adapter can grant access to this exact profile/workspace.
      const consent: ImportConsent = {
        ...args.consent,
        osCredentialsApproved: false,
        ...(args.consent.cookies ? { domains: exactDomains(args.consent.domains ?? []) } : {}),
      }
      const act = rpcBrowserProfileImportActResult({
        source: 'native',
        action: 'write',
        nativeId: args.profileId,
      })
      if (!isClaimableLive(act)) throw new Error('browser profile import is not live')
      const paths = pathsForWorkspace(args.workspaceId)
      if (!paths) throw new Error('Workspace not found')
      if (importsInFlight.has(args.workspaceId)) throw new Error('browser-profile-import-pending')
      const profile = discoverBrowserProfileById({ home, platform, fs, profileId: args.profileId })
      if (!profile) throw new Error('Profile not found')

      const accountRef = consentAccountRef(args.profileId)
      const cookieGranted = consent.cookies === true
      let credentials: Awaited<ReturnType<typeof prepareBrowserCredentialImport>> | undefined
      importsInFlight.add(args.workspaceId)
      try {
        if (consent.credentials) {
          if (ctx.workspaceId !== args.workspaceId) credentials = { status: 'denied', dispose() {} }
          else if (!deps.browserCredentials || ctx.webContentsId == null || profile.state === 'locked' || profile.state === 'unsupported') {
            credentials = { status: 'unsupported', dispose() {} }
          } else credentials = await prepareBrowserCredentialImport({ host: deps.browserCredentials, workspaceId: args.workspaceId, webContentsId: ctx.webContentsId, platform, profile })
          consent.osCredentialsApproved = credentials.status === 'granted'
        }
        if (cookieGranted && !args.dryRun) {
          setProviderAccessConsent({
            provider: COOKIE_PROVIDER,
            accountRef,
            domains: consent.domains ?? [],
            dataScopes: ['cookies'],
            purposes: [PROFILE_IMPORT_PURPOSE],
            granted: true,
          })
        }
        const state = args.dryRun || !cookieGranted ? null : loadPrivacyState()
        const authorizedScopes = {
          cookies: cookieGranted && (args.dryRun || (consent.domains ?? []).every((domain) =>
            providerScopeAllowed(state!, COOKIE_PROVIDER, accountRef, domain, 'cookies', PROFILE_IMPORT_PURPOSE),
          )),
          credentials: credentials?.status === 'granted',
        }
        const summary = importProfile({
          profile,
          consent,
          authorizedScopes,
          protectedCookies: protectedCookieAccess(args.workspaceId, args.profileId),
          protectedCredentials: credentials?.protectedCredentials,
          nativeData: readNativeBrowserData,
          fs,
          indexPath: paths.indexPath,
          vaultPath: paths.vaultPath,
          credentialVaultPath: paths.credentialVaultPath,
          dryRun: Boolean(args.dryRun),
        })
        return credentials ? { ...summary, credentialAccess: credentials.status } : summary
      } finally {
        try {
          if (cookieGranted && !args.dryRun) {
            setProviderAccessConsent({
              provider: COOKIE_PROVIDER,
              accountRef,
              domains: [],
              dataScopes: [],
              purposes: [],
              granted: false,
            })
          }
        } finally {
          credentials?.dispose()
          importsInFlight.delete(args.workspaceId)
        }
      }
    },
  )

  server.handle(RPC_CHANNELS.browserProfile.ROLLBACK, (_ctx, args: { workspaceId: string; token: string }) => {
    const act = rpcBrowserProfileImportActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: args.token,
    })
    if (!isClaimableLive(act)) return { ok: false }
    const paths = pathsForWorkspace(args.workspaceId)
    if (!paths) throw new Error('Workspace not found')
    if (importsInFlight.has(args.workspaceId)) throw new Error('browser-profile-import-pending')
    autoImporter.set(args.workspaceId, false)
    return { ok: rollbackImport(fs, paths.indexPath, args.token, { vaultPath: paths.vaultPath, deleteKey: deleteProtectedCookieKey },
      deps.browserCredentials ? { vaultPath: paths.credentialVaultPath, deleteKey: reference => deps.browserCredentials!.vaultKeys.deleteKey(reference) } : undefined) }
  })

  server.handle(RPC_CHANNELS.browserProfile.DELETE, (_ctx, workspaceId: string) => {
    const act = rpcBrowserProfileImportActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: workspaceId,
    })
    if (!isClaimableLive(act)) return { ok: false }
    const paths = pathsForWorkspace(workspaceId)
    if (!paths) throw new Error('Workspace not found')
    if (importsInFlight.has(workspaceId)) throw new Error('browser-profile-import-pending')
    autoImporter.set(workspaceId, false)
    const read = rpcBrowserProfileImportReadResult({ source: 'native', nativeId: workspaceId })
    if (!isClaimableLive(read.result)) return { ok: false }
    return deleteImportedProfile({
      fs,
      indexPath: paths.indexPath,
      vaultPath: paths.vaultPath,
      protectedCookies: protectedCookieAccess(workspaceId, ''),
      credentialVaultPath: paths.credentialVaultPath,
      credentialCustody: deps.browserCredentials ? { deleteKey: reference => deps.browserCredentials!.vaultKeys.deleteKey(reference) } : undefined,
    })
  })
}
