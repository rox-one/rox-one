/**
 * Issue 15 RPC: privileged browser profile import.
 * Cookie/credential bytes never leave this process in the RPC result.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  deleteImportedProfile,
  discoverBrowserProfiles,
  importProfile,
  rollbackImport,
  type ImportConsent,
  type ProfileFs,
} from '@craft-agent/shared/browser/profile-import'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

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

export function registerBrowserProfileImportHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const fs = nodeFs()

  server.handle(RPC_CHANNELS.browserProfile.DISCOVER, (_ctx, explicitId?: string) => {
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
      const paths = pathsFor(args.workspaceId)
      if (!paths) throw new Error('Workspace not found')
      const profiles = discoverBrowserProfiles({
        home: homedir(),
        platform: process.platform,
        fs,
        explicitId: args.profileId,
      })
      const profile = profiles.find((item) => item.id === args.profileId)
      if (!profile) throw new Error('Profile not found')
      return importProfile({
        profile,
        consent: args.consent,
        fs,
        indexPath: paths.indexPath,
        vaultPath: paths.vaultPath,
        dryRun: Boolean(args.dryRun),
      })
    },
  )

  server.handle(RPC_CHANNELS.browserProfile.ROLLBACK, (_ctx, args: { workspaceId: string; token: string }) => {
    const paths = pathsFor(args.workspaceId)
    if (!paths) throw new Error('Workspace not found')
    return { ok: rollbackImport(fs, paths.indexPath, args.token) }
  })

  server.handle(RPC_CHANNELS.browserProfile.DELETE, (_ctx, workspaceId: string) => {
    const paths = pathsFor(workspaceId)
    if (!paths) throw new Error('Workspace not found')
    return deleteImportedProfile({ fs, indexPath: paths.indexPath, vaultPath: paths.vaultPath })
  })
}
