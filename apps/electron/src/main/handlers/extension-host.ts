/**
 * Extension Host RPC handlers (S-05 §3.5 / W6 + capability broker).
 *
 * LOCAL_ONLY lifecycle + craft-sandbox load/call over ExtensionHostManager.
 * Capability mint/revoke/proxyFetch never return raw secrets to callers.
 * Does not execute SiYuan plugins (executesSiyuanPlugins always false).
 *
 * Per-workspace hosts: optional workspaceId on args selects the manager key.
 * URL allowlist is durable per extensionId under configDir/extensions/.
 *
 * LOAD grants are resolved solely from workspace permissions.json — renderer
 * cannot self-supply grantedPermissions.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseExtensionManifest } from '@rox/shared/extensions'
import { assertPathAllowlisted, resolveSandboxRoots } from '../extension-host/path-allowlist'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { RPC_CHANNELS } from '../../shared/types'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import {
  getExtensionHostManager,
  listExtensionHostStatuses,
} from '../extension-host-manager'
import {
  getUrlAllowlist,
  setUrlAllowlist,
} from '../extension-host/extension-url-allowlist'
import type { ExtensionHostStatus } from '@rox/shared/extensions'
import { resolveExtensionGrantsFromPermissions } from '../extension-host/grants'
import {
  activateExtension,
  listSandboxDescriptors,
} from '../extension-host/startup'
import type {
  ExtensionHostActivateResult,
  ExtensionHostListDescriptorsResult,
} from '../../shared/types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.extensionHost.STATUS,
  RPC_CHANNELS.extensionHost.STATUS_ALL,
  RPC_CHANNELS.extensionHost.START,
  RPC_CHANNELS.extensionHost.STOP,
  RPC_CHANNELS.extensionHost.RESTART,
  RPC_CHANNELS.extensionHost.LOAD,
  RPC_CHANNELS.extensionHost.CALL,
  RPC_CHANNELS.extensionHost.LIST_COMMANDS,
  RPC_CHANNELS.extensionHost.LIST_CAPABILITIES,
  RPC_CHANNELS.extensionHost.MINT_CAPABILITY,
  RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY,
  RPC_CHANNELS.extensionHost.PROXY_FETCH,
  RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST,
  RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST,
  RPC_CHANNELS.extensionHost.LIST_DESCRIPTORS,
  RPC_CHANNELS.extensionHost.ACTIVATE,
] as const

type WorkspaceArgs = { workspaceId?: string | null }

// Grants resolve solely from workspace permissions.json. The implementation
// lives in extension-host/grants.ts (leaf) so the startup activation path can
// share it without an import cycle; re-exported here for existing callers.
export { resolveExtensionGrantsFromPermissions } from '../extension-host/grants'


export function registerExtensionHostHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
): void {
  server.handle(
    RPC_CHANNELS.extensionHost.STATUS,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).getStatus()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.STATUS_ALL,
    async (): Promise<Array<{ workspaceId: string } & ExtensionHostStatus>> => {
      return listExtensionHostStatuses()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.START,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).start()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.STOP,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).stop()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.RESTART,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostStatus> => {
      return getExtensionHostManager(args?.workspaceId).restart()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.LOAD,
    async (
      _ctx,
      args: {
        extensionId: string
        entryPath: string
        /** Ignored — grants come from workspace permissions.json only. */
        grantedPermissions?: string[]
        workspaceId?: string | null
      },
    ): Promise<{ ok: true }> => {
      if (!args || typeof args.extensionId !== 'string' || typeof args.entryPath !== 'string') {
        throw new Error('extensionHost.load requires { extensionId, entryPath }')
      }
      const roots = resolveSandboxRoots({ configDir: resolveConfigDir() })
      const manifestPath = assertPathAllowlisted(join(dirname(args.entryPath), 'manifest.json'), roots)
      const manifest = parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
      if (manifest.id !== args.extensionId || manifest.runtime !== 'craft-sandbox') {
        throw new Error('Extension manifest identity/runtime does not match the loaded package')
      }
      const grants = resolveExtensionGrantsFromPermissions(args.workspaceId, args.extensionId)
      const declared = new Set(manifest.permissions)
      const operations = manifest.operations ?? {}
      for (const [method, permissions] of Object.entries(operations)) {
        if (permissions.some((permission) => !declared.has(permission))) {
          throw new Error(`Extension operation '${method}' requires a capability absent from its manifest`)
        }
      }
      await getExtensionHostManager(args.workspaceId).loadExtension(
        args.extensionId,
        args.entryPath,
        grants,
        operations,
      )
      return { ok: true }
    },
  )


  server.handle(
    RPC_CHANNELS.extensionHost.CALL,
    async (
      _ctx,
      args: {
        extensionId: string
        method: string
        args?: unknown[]
        workspaceId?: string | null
      },
    ): Promise<unknown> => {
      if (!args || typeof args.extensionId !== 'string' || typeof args.method !== 'string') {
        throw new Error('extensionHost.call requires { extensionId, method }')
      }
      return getExtensionHostManager(args.workspaceId).callExtension(
        args.extensionId,
        args.method,
        args.args,
      )
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.LIST_COMMANDS,
    async (
      _ctx,
      args: { extensionId: string; workspaceId?: string | null },
    ): Promise<Array<{
      id: string
      title: string
      when?: string
      defaultHotkey?: string
      keywords?: string[]
    }>> => {
      if (!args || typeof args.extensionId !== 'string') {
        throw new Error('extensionHost.listCommands requires { extensionId }')
      }
      return getExtensionHostManager(args.workspaceId).listExtensionCommands(args.extensionId)
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.MINT_CAPABILITY,
    async (
      _ctx,
      args: {
        extensionId: string
        permission: string
        ttlMs?: number
        singleUse?: boolean
        workspaceId?: string | null
      },
    ): Promise<{ token: string; expiresAt: number; permission: string }> => {
      if (
        !args ||
        typeof args.extensionId !== 'string' ||
        typeof args.permission !== 'string'
      ) {
        throw new Error(
          'extensionHost.mintCapability requires { extensionId, permission }',
        )
      }
      // Never trust renderer-supplied grantedPermissions — loadExtension only.
      return getExtensionHostManager(args.workspaceId).mintCapability({
        extensionId: args.extensionId,
        permission: args.permission,
        ttlMs: args.ttlMs,
        singleUse: args.singleUse,
      })
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.LIST_CAPABILITIES,
    async (_ctx, args?: WorkspaceArgs) => {
      return getExtensionHostManager(args?.workspaceId).listCapabilities()
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY,
    async (
      _ctx,
      args: {
        token?: string
        tokenHash?: string
        extensionId?: string
        workspaceId?: string | null
      },
    ): Promise<{ ok: true }> => {
      if (
        !args ||
        (typeof args.token !== 'string' &&
          typeof args.tokenHash !== 'string' &&
          typeof args.extensionId !== 'string')
      ) {
        throw new Error(
          'extensionHost.revokeCapability requires { token }, { tokenHash }, or { extensionId }',
        )
      }
      const mgr = getExtensionHostManager(args.workspaceId)
      if (typeof args.token === 'string') mgr.revokeCapability(args.token)
      if (typeof args.tokenHash === 'string') mgr.revokeCapabilityByTokenHash(args.tokenHash)
      if (typeof args.extensionId === 'string') {
        mgr.revokeExtensionCapabilities(args.extensionId)
      }
      return { ok: true }
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.PROXY_FETCH,
    async (
      _ctx,
      args: {
        token: string
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        allowedUrlPrefixes?: string[]
        workspaceId?: string | null
      },
    ): Promise<{ status: number; body: string; headers: Record<string, string> }> => {
      if (!args || typeof args.token !== 'string' || typeof args.url !== 'string') {
        throw new Error('extensionHost.proxyFetch requires { token, url }')
      }
      // Manager merges durable store allowlist; do not trust renderer alone.
      return getExtensionHostManager(args.workspaceId).proxyFetch({
        token: args.token,
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
        allowedUrlPrefixes: args.allowedUrlPrefixes,
      })
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST,
    async (
      _ctx,
      args: { extensionId: string },
    ): Promise<{ prefixes: string[] }> => {
      if (!args || typeof args.extensionId !== 'string') {
        throw new Error('extensionHost.getUrlAllowlist requires { extensionId }')
      }
      return {
        prefixes: getUrlAllowlist(args.extensionId, resolveConfigDir()),
      }
    },
  )

  server.handle(
    RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST,
    async (
      _ctx,
      args: { extensionId: string; prefixes: string[] },
    ): Promise<{ prefixes: string[] }> => {
      if (!args || typeof args.extensionId !== 'string' || !Array.isArray(args.prefixes)) {
        throw new Error(
          'extensionHost.setUrlAllowlist requires { extensionId, prefixes }',
        )
      }
      return {
        prefixes: setUrlAllowlist(args.extensionId, args.prefixes, resolveConfigDir()),
      }
    },
  )

  // S-05 §3.5 wave 3 — descriptor plane. Never forks the host: discovery is a
  // pure filesystem scan and getStatus() is a snapshot. Only validated
  // packages appear in `descriptors`; invalid/shadowed ids stay visible via
  // their `descriptor-invalid` / `shadowed:` plan reason.
  server.handle(
    RPC_CHANNELS.extensionHost.LIST_DESCRIPTORS,
    async (_ctx, args?: WorkspaceArgs): Promise<ExtensionHostListDescriptorsResult> => {
      const listing = listSandboxDescriptors({ workspaceId: args?.workspaceId })
      const loaded = new Set(listing.loaded)
      return {
        descriptors: listing.descriptors.flatMap((descriptor) => {
          if (descriptor.status !== 'ok' || !descriptor.entryPath) return []
          return [
            {
              extensionId: descriptor.id,
              entryPath: descriptor.entryPath,
              manifestPath: join(descriptor.dir, 'manifest.json'),
              ...(descriptor.manifest
                ? { name: descriptor.manifest.name, version: descriptor.manifest.version }
                : {}),
              active: loaded.has(descriptor.id),
              grantedPermissions: resolveExtensionGrantsFromPermissions(
                args?.workspaceId,
                descriptor.id,
              ),
            },
          ]
        }),
        plan: listing.plan.map((item) => ({ extensionId: item.id, reason: item.reason })),
        loaded: listing.loaded,
      }
    },
  )

  // Explicit activation: descriptor ok + enabled + craft-sandbox + fresh grants.
  // Refusals are typed (ExtensionActivationError.code) for the renderer.
  server.handle(
    RPC_CHANNELS.extensionHost.ACTIVATE,
    async (
      _ctx,
      args: { extensionId: string; trigger?: string; workspaceId?: string | null },
    ): Promise<ExtensionHostActivateResult> => {
      if (!args || typeof args.extensionId !== 'string') {
        throw new Error('extensionHost.activate requires { extensionId }')
      }
      const commands = await activateExtension({
        extensionId: args.extensionId,
        workspaceId: args.workspaceId,
      })
      return { commands }
    },
  )
}
