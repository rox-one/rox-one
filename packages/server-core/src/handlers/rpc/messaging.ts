/**
 * Messaging RPC handlers — UI ↔ Server communication for messaging config and bindings.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import type {
  MessagingBindingAccessMode,
  MessagingPendingRejectReason,
  MessagingPendingSenderInfo,
  MessagingPlatformAccessMode,
  MessagingPlatformOwnerInfo,
} from '../messaging-registry-interface'
import {
  isClaimableLive,
  rpcMessagingActResult,
  rpcMessagingListResult,
  rpcMessagingReadResult,
} from '@craft-agent/core/rox2'
import { assertNativeInboxPath, assertNativeInboxWorkspace, isInboxOwner, nativeInboxOwner } from './native-inbox-scope'
import { assertNativeSession } from './native-session-scope'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'
import { CodedError } from '@craft-agent/shared/protocol'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { dirname } from 'node:path'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.messaging.GET_CONFIG,
  RPC_CHANNELS.messaging.UPDATE_CONFIG,
  RPC_CHANNELS.messaging.TEST_TELEGRAM,
  RPC_CHANNELS.messaging.SAVE_TELEGRAM,
  RPC_CHANNELS.messaging.TEST_LARK,
  RPC_CHANNELS.messaging.SAVE_LARK,
  RPC_CHANNELS.messaging.TEST_DISCORD,
  RPC_CHANNELS.messaging.SAVE_DISCORD,
  RPC_CHANNELS.messaging.DISCONNECT,
  RPC_CHANNELS.messaging.FORGET,
  RPC_CHANNELS.messaging.GET_BINDINGS,
  RPC_CHANNELS.messaging.GENERATE_CODE,
  RPC_CHANNELS.messaging.UNBIND,
  RPC_CHANNELS.messaging.UNBIND_BINDING,
  RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE,
  RPC_CHANNELS.messaging.GET_SUPERGROUP,
  RPC_CHANNELS.messaging.UNBIND_SUPERGROUP,
  RPC_CHANNELS.messaging.WA_START_CONNECT,
  RPC_CHANNELS.messaging.WA_SUBMIT_PHONE,
  RPC_CHANNELS.messaging.WECHAT_START_CONNECT,
  RPC_CHANNELS.messaging.WECHAT_SUBMIT_CODE,
  RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
  RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
  RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
  RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
  RPC_CHANNELS.messaging.SET_DISCORD_GUILD_TRIGGER,
  RPC_CHANNELS.messaging.WC_START_CONNECT,
  RPC_CHANNELS.messaging.WC_CANCEL_CONNECT,
] as const

export function registerMessagingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const registry = deps.messagingRegistry
  if (!registry) return
  registry.setNativeBindingContextResolver?.(binding => {
    const workspace = readNativeWorkspaceRegistry(binding.workspaceId)
    const authority = deps.nativeData?.authority
    if (!workspace || !authority) return
    const owner = authority.authorizeMessagingBinding(binding, workspace.rootPath)
    if (!owner) return
    return { owner, assertAuthorized: () => {
      const current = readNativeWorkspaceRegistry(binding.workspaceId)
      if (!current || current.rootPath !== workspace.rootPath || !authority.authorizeMessagingBinding(binding, current.rootPath)
        || !deps.sessionManager.getSessions(binding.workspaceId).some(session => session.id === binding.sessionId && session.workspaceId === binding.workspaceId)) throw new CodedError('FORBIDDEN', 'Native binding access denied')
      assertNativeInboxPath(current.rootPath, ['messaging'], true)
      assertNativeInboxPath(current.rootPath, ['memory'], true)
      assertNativeInboxPath(current.rootPath, ['skills', '.pending'], true)
      assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
    } }
  })

  const ownsPendingBinding = (ctx: RequestContext, root: string | undefined, sender: MessagingPendingSenderInfo): boolean => {
    if (!ctx.principal) return true
    if (!root || !isInboxOwner(sender.nativeOwner, ctx) || sender.reason !== 'not-on-binding-allowlist' || !sender.bindingId) return false
    const binding = registry.getBindings(ctx.workspaceId!).find(item => item.id === sender.bindingId && item.platform === sender.platform && item.workspaceId === ctx.workspaceId)
    return !!binding && isInboxOwner(binding.nativeOwner, ctx)
      && isInboxOwner(deps.nativeData?.authority.authorizeMessagingBinding(binding, root) ?? undefined, ctx)
  }

  server.handle(RPC_CHANNELS.messaging.GET_CONFIG, async (ctx) => {
    const listed = rpcMessagingListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('messaging config is not live')
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.getConfig(ctx.workspaceId)
  })

  server.handle(RPC_CHANNELS.messaging.UPDATE_CONFIG, async (ctx, config: Record<string, unknown>) => {
    const act = rpcMessagingActResult({
      source: 'native',
      action: 'write',
      nativeId: ctx.workspaceId ?? 'config',
    })
    if (!isClaimableLive(act)) return { success: false }
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.updateConfig(ctx.workspaceId, config)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.TEST_TELEGRAM, async (_ctx, token: string) => {
    return registry.testTelegramToken(token)
  })

  server.handle(RPC_CHANNELS.messaging.SAVE_TELEGRAM, async (ctx, token: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.saveTelegramToken(ctx.workspaceId, token)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.TEST_LARK, async (
    _ctx,
    creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' },
  ) => {
    return registry.testLarkCredentials(creds)
  })

  server.handle(RPC_CHANNELS.messaging.SAVE_LARK, async (
    ctx,
    creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' },
  ) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.saveLarkCredentials(ctx.workspaceId, creds)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.TEST_DISCORD, async (
    _ctx,
    creds: { token: string },
  ) => {
    return registry.testDiscordCredentials(creds)
  })

  server.handle(RPC_CHANNELS.messaging.SAVE_DISCORD, async (
    ctx,
    creds: { token: string },
  ) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.saveDiscordCredentials(ctx.workspaceId, creds)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.DISCONNECT, async (ctx, platform: string) => {
    if (!platform) throw new Error('messaging.disconnect: platform is required')
    const act = rpcMessagingActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: platform,
    })
    if (!isClaimableLive(act)) return { success: false }
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.disconnectPlatform(ctx.workspaceId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.FORGET, async (ctx, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.forgetPlatform(ctx.workspaceId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.GET_BINDINGS, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    const read = rpcMessagingReadResult({ source: 'native', nativeId: ctx.workspaceId })
    if (!isClaimableLive(read.result)) return []
    const root = assertNativeInboxWorkspace(ctx, deps, server, ctx.workspaceId)
    return registry.getBindings(ctx.workspaceId).filter(binding => binding.workspaceId === ctx.workspaceId && isInboxOwner(binding.nativeOwner, ctx)
      && (!ctx.principal || !!deps.nativeData?.authority.authorizeMessagingBinding(binding, root!)))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.messaging.GENERATE_CODE, async (ctx, sessionId: string, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    const root = assertNativeInboxWorkspace(ctx, deps, server, ctx.workspaceId, 'write')
    if (!ctx.principal) return registry.generatePairingCode(ctx.workspaceId, sessionId, platform)
    assertNativeSession(ctx, deps, server, sessionId)
    const principal = ctx.principal, workspaceId = ctx.workspaceId, owner = nativeInboxOwner(ctx)!
    const fence = deps.nativeData!.authority.permissionFence(principal, workspaceId, 'write')
    // The one-time code delegates this session only. It never delegates bot
    // configuration, host credentials, or the workspace bot's owners list.
    return registry.generatePairingCode(workspaceId, sessionId, platform, { owner, assertAuthorized: () => {
      const workspace = readNativeWorkspaceRegistry(workspaceId)
      if (!workspace || workspace.rootPath !== root || !fence || deps.nativeData?.authority.permissionFence(principal, workspaceId, 'write') !== fence
        || !deps.nativeData.authority.authorize(principal, workspaceId, 'write', root)
        || !deps.sessionManager.getSessions(workspaceId).some(session => session.id === sessionId && session.workspaceId === workspaceId)) {
        throw new CodedError('FORBIDDEN', 'Native pairing access denied')
      }
      assertNativeInboxPath(root!, ['messaging'], true)
      assertNativeInboxPath(root!, ['memory'], true)
      assertNativeInboxPath(root!, ['skills', '.pending'], true)
      assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
    }, registerBinding: binding => {
      if (binding.workspaceId !== workspaceId || binding.sessionId !== sessionId) throw new CodedError('FORBIDDEN', 'Native binding mismatch')
      deps.nativeData!.authority.registerMessagingBinding(principal, binding, root!)
    }, canReplaceBinding: binding => {
      if (binding.workspaceId !== workspaceId || !fence || deps.nativeData!.authority.permissionFence(principal, workspaceId, 'write') !== fence
        || !deps.nativeData!.authority.authorize(principal, workspaceId, 'write', root)) return false
      const previousOwner = deps.nativeData!.authority.getMessagingBindingOwner(binding, root!)
      return previousOwner?.issuer === owner.issuer && previousOwner.subject === owner.subject
    } })
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.messaging.UNBIND, async (ctx, sessionId: string, platform?: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    registry.unbindSession(ctx.workspaceId, sessionId, platform)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.UNBIND_BINDING, async (ctx, bindingId: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return { success: registry.unbindBinding(ctx.workspaceId, bindingId) }
  })

  // Workspace-supergroup pairing (Telegram forum support — Phase A)
  server.handle(RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE, async (ctx, platform: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.generateSupergroupPairingCode(ctx.workspaceId, platform)
  })

  server.handle(RPC_CHANNELS.messaging.GET_SUPERGROUP, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    return registry.getWorkspaceSupergroup(ctx.workspaceId)
  })

  server.handle(RPC_CHANNELS.messaging.UNBIND_SUPERGROUP, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.unbindWorkspaceSupergroup(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WA_START_CONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.startWhatsAppConnect(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WA_SUBMIT_PHONE, async (ctx, phoneNumber: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.submitWhatsAppPhone(ctx.workspaceId, phoneNumber)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WECHAT_START_CONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.startWeChatConnect(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WECHAT_SUBMIT_CODE, async (ctx, code: string) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    registry.submitWeChatVerifyCode(ctx.workspaceId, code)
    return { success: true }
  })

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  server.handle(
    RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
    async (ctx, platform: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.getPlatformOwners(ctx.workspaceId, platform)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
    async (ctx, platform: string, owners: MessagingPlatformOwnerInfo[]) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.setPlatformOwners(ctx.workspaceId, platform, owners)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
    async (ctx, platform: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      return registry.getPlatformAccessMode(ctx.workspaceId, platform)
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
    async (ctx, platform: string, mode: MessagingPlatformAccessMode) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      registry.setPlatformAccessMode(ctx.workspaceId, platform, mode)
      return { success: true }
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
    async (ctx, platform?: string) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      const root = assertNativeInboxWorkspace(ctx, deps, server, ctx.workspaceId)
      if (root) assertNativeInboxPath(root, ['messaging'], true)
      return registry.getPendingSenders(ctx.workspaceId, platform).filter(sender => ownsPendingBinding(ctx, root, sender))
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
    async (ctx, platform: string, userId: string, entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string }) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      const root = assertNativeInboxWorkspace(ctx, deps, server, ctx.workspaceId, 'write')
      if (root) assertNativeInboxPath(root, ['messaging'], true)
      let authorizedKey = entryKey
      if (ctx.principal) {
        const entries = registry.getPendingSenders(ctx.workspaceId, platform).filter(sender => sender.userId === userId)
        const selected = entries.find(sender => ownsPendingBinding(ctx, root, sender)
          && (!entryKey?.reason || (sender.reason ?? 'not-owner') === entryKey.reason) && (!entryKey?.bindingId || sender.bindingId === entryKey.bindingId))
        if (!selected) throw new Error('Pending sender access denied')
        authorizedKey = { reason: selected.reason ?? 'not-owner', bindingId: selected.bindingId }
      }
      return { success: registry.dismissPendingSender(ctx.workspaceId, platform, userId, authorizedKey) }
    },
    { nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
    async (
      ctx,
      platform: string,
      userId: string,
      entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string },
    ) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      const root = assertNativeInboxWorkspace(ctx, deps, server, ctx.workspaceId, 'write')
      if (root) assertNativeInboxPath(root, ['messaging'], true)
      let authorizedKey = entryKey
      if (ctx.principal) {
        const entries = registry.getPendingSenders(ctx.workspaceId, platform).filter(sender => sender.userId === userId)
        const selected = entries.find(sender => ownsPendingBinding(ctx, root, sender) && (!entryKey?.reason || sender.reason === entryKey.reason) && (!entryKey?.bindingId || sender.bindingId === entryKey.bindingId))
        const binding = selected?.bindingId && registry.getBindings(ctx.workspaceId).find(binding => binding.id === selected.bindingId)
        // A pending sender cannot grant control over the machine's shared bot.
        if (!selected || selected.reason !== 'not-on-binding-allowlist'
          || !binding || !isInboxOwner(binding.nativeOwner, ctx)
          || !root || !isInboxOwner(deps.nativeData?.authority.authorizeMessagingBinding(binding, root) ?? undefined, ctx)) throw new Error('Pending sender access denied')
        authorizedKey = { reason: selected.reason, bindingId: selected.bindingId }
      }
      const result = registry.allowPendingSender(ctx.workspaceId, platform, userId, authorizedKey)
      return ctx.principal ? { owners: [], ...(result.bindingId ? { bindingId: result.bindingId } : {}) } : result
    },
    { nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
    async (
      ctx,
      bindingId: string,
      access: { mode: MessagingBindingAccessMode; allowedSenderIds?: string[] },
    ) => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      registry.setBindingAccess(ctx.workspaceId, bindingId, access)
      return { success: true }
    },
  )

  server.handle(
    RPC_CHANNELS.messaging.SET_DISCORD_GUILD_TRIGGER,
    async (ctx, bindingId: string, trigger: 'mention' | 'all') => {
      if (!ctx.workspaceId) throw new Error('Missing workspaceId')
      if (trigger !== 'mention' && trigger !== 'all') {
        throw new Error('discordGuildTrigger must be mention or all')
      }
      registry.setDiscordGuildTrigger(ctx.workspaceId, bindingId, trigger)
      return { success: true }
    },
  )
  server.handle(RPC_CHANNELS.messaging.WC_START_CONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.startWeChatConnect(ctx.workspaceId)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.messaging.WC_CANCEL_CONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('Missing workspaceId')
    await registry.cancelWeChatConnect(ctx.workspaceId)
    return { success: true }
  })
}
