/**
 * Issue 15 RPC: privileged browser profile import.
 * Cookie/credential bytes never leave this process in the RPC result.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  deleteImportedProfile,
  discoverBrowserProfileById,
  discoverBrowserProfiles,
  importProfile,
  rollbackImport,
  type ImportConsent,
  type ProfileFs,
  type ProtectedCookieImport,
} from '@craft-agent/shared/browser/profile-import'
import {
  loadPrivacyState,
  providerScopeAllowed,
  setProviderAccessConsent,
} from '@craft-agent/shared/privacy'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcBrowserProfileImportActResult,
  rpcBrowserProfileImportListResult,
  rpcBrowserProfileImportReadResult,
} from '@craft-agent/core/rox2'

export const BROWSER_PROFILE_CHANNELS = [
  RPC_CHANNELS.browserProfile.DISCOVER,
  RPC_CHANNELS.browserProfile.IMPORT,
  RPC_CHANNELS.browserProfile.ROLLBACK,
  RPC_CHANNELS.browserProfile.DELETE,
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
      writeFileSync(path, contents)
    },
    listPaths: (prefix) => existsSync(dirname(prefix)) ? readdirSync(dirname(prefix)).map(name => join(dirname(prefix), name)).filter(path => path.startsWith(prefix)) : [],
    remove: (path) => {
      if (existsSync(path)) rmSync(path)
    },
  }
}

function pathsFor(workspaceId: string): { root: string; indexPath: string; vaultPath: string } | null {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  const dir = join(workspace.rootPath, 'browser')
  return {
    root: workspace.rootPath,
    indexPath: join(dir, 'profile-index.json'),
    vaultPath: join(dir, 'cookie-vault.json'),
  }
}

const COOKIE_PROVIDER = 'browser-profile-cookies'
const CREDENTIAL_PROVIDER = 'browser-profile-credentials'
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

function deleteProtectedCookieKey(reference: string): boolean {
  const service = 'rox.browser-profile-cookie-vault'
  try {
    if (process.platform === 'darwin') {
      execFileSync('security', ['delete-generic-password', '-s', service, '-a', reference], { stdio: 'ignore' })
      return true
    }
    if (process.platform === 'linux') {
      return spawnSync('secret-tool', ['clear', 'service', service, 'account', reference], {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
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

export function registerBrowserProfileImportHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const fs = nodeFs()

  server.handle(RPC_CHANNELS.browserProfile.DISCOVER, (_ctx, args?: { consent?: boolean; explicitId?: string }) => {
    if (args?.consent !== true) return []
    const explicitId = args.explicitId
    const listed = rpcBrowserProfileImportListResult({
      source: 'native',
      nativeIds: explicitId ? [explicitId] : [],
    })
    if (!isClaimableLive(listed.result)) return []
    return discoverBrowserProfiles({
      home: homedir(),
      platform: process.platform,
      fs,
      explicitId,
    })
  })

  server.handle(
    RPC_CHANNELS.browserProfile.IMPORT,
    (_ctx, args: { workspaceId: string; profileId: string; consent: ImportConsent; dryRun?: boolean }) => {
      const consent = args.consent.cookies
        ? { ...args.consent, domains: exactDomains(args.consent.domains ?? []) }
        : args.consent
      const act = rpcBrowserProfileImportActResult({
        source: 'native',
        action: 'write',
        nativeId: args.profileId,
      })
      if (!isClaimableLive(act)) throw new Error('browser profile import is not live')
      const paths = pathsFor(args.workspaceId)
      if (!paths) throw new Error('Workspace not found')

      const accountRef = consentAccountRef(args.profileId)
      const cookieGranted = consent.cookies === true
      const credentialsGranted = consent.credentials === true && consent.osCredentialsApproved === true
      if (cookieGranted) {
        setProviderAccessConsent({
          provider: COOKIE_PROVIDER,
          accountRef,
          domains: consent.domains ?? [],
          dataScopes: ['cookies'],
          purposes: [PROFILE_IMPORT_PURPOSE],
          granted: true,
        })
      }
      if (credentialsGranted) {
        setProviderAccessConsent({
          provider: CREDENTIAL_PROVIDER,
          accountRef,
          domains: ['*'],
          dataScopes: ['credentials'],
          purposes: [PROFILE_IMPORT_PURPOSE],
          granted: true,
        })
      }
      try {
        const state = loadPrivacyState()
        const authorizedScopes = {
          cookies: cookieGranted && (consent.domains ?? []).every((domain) =>
            providerScopeAllowed(state, COOKIE_PROVIDER, accountRef, domain, 'cookies', PROFILE_IMPORT_PURPOSE),
          ),
          credentials: credentialsGranted &&
            providerScopeAllowed(state, CREDENTIAL_PROVIDER, accountRef, '*', 'credentials', PROFILE_IMPORT_PURPOSE),
        }
        const profile = discoverBrowserProfileById({
          home: homedir(),
          platform: process.platform,
          fs,
          profileId: args.profileId,
        })
        if (!profile) throw new Error('Profile not found')
        return importProfile({
          profile,
          consent,
          authorizedScopes,
          protectedCookies: protectedCookieAccess(args.workspaceId, args.profileId),
          fs,
          indexPath: paths.indexPath,
          vaultPath: paths.vaultPath,
          dryRun: Boolean(args.dryRun),
        })
      } finally {
        if (cookieGranted) {
          setProviderAccessConsent({
            provider: COOKIE_PROVIDER,
            accountRef,
            domains: [],
            dataScopes: [],
            purposes: [],
            granted: false,
          })
        }
        if (credentialsGranted) {
          setProviderAccessConsent({
            provider: CREDENTIAL_PROVIDER,
            accountRef,
            domains: [],
            dataScopes: [],
            purposes: [],
            granted: false,
          })
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
    const paths = pathsFor(args.workspaceId)
    if (!paths) throw new Error('Workspace not found')
    return { ok: rollbackImport(fs, paths.indexPath, args.token, { vaultPath: paths.vaultPath, deleteKey: deleteProtectedCookieKey }) }
  })

  server.handle(RPC_CHANNELS.browserProfile.DELETE, (_ctx, workspaceId: string) => {
    const act = rpcBrowserProfileImportActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: workspaceId,
    })
    if (!isClaimableLive(act)) return { ok: false }
    const paths = pathsFor(workspaceId)
    if (!paths) throw new Error('Workspace not found')
    const read = rpcBrowserProfileImportReadResult({ source: 'native', nativeId: workspaceId })
    if (!isClaimableLive(read.result)) return { ok: false }
    return deleteImportedProfile({
      fs,
      indexPath: paths.indexPath,
      vaultPath: paths.vaultPath,
      protectedCookies: protectedCookieAccess(workspaceId, ''),
    })
  })
}
