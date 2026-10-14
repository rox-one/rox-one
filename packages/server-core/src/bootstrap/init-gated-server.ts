import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RpcHandlerOptions, RpcServer } from '../transport/types'

/**
 * Channels answered before the session manager finishes `initialize()`. Each
 * handler reads only config files, theme files, the window registry or process
 * facts — never sessions, LLM connections, workspace watchers or credentials,
 * which initialization migrates/loads. Every other channel waits for it.
 */
export const PRE_INIT_CHANNELS: ReadonlySet<string> = new Set([
  RPC_CHANNELS.appearance.GET_DEFAULT_ZOOM_LEVEL,
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.GET_SHELL_SNAPSHOT,
  RPC_CHANNELS.appearance.GET_UI_PREFERENCES,
  RPC_CHANNELS.input.GET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.GET_SPELL_CHECK,
  RPC_CHANNELS.notification.GET_ENABLED,
  RPC_CHANNELS.server.HOME_DIR,
  RPC_CHANNELS.system.CONFIG_DIR,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.window.GET_FOCUS_STATE,
  RPC_CHANNELS.window.GET_MODE,
])

/**
 * The server handed to handler registration: every handler outside
 * `preInitChannels` first awaits `whenInitialized()` (rejecting with the
 * initialization error if it failed). The wait runs inside the transport's
 * handler timeout. All other members delegate to the real server, so
 * registration-time identity (e.g. per-server WeakMaps) stays stable.
 */
export function gateRpcServerOnInitialization<TServer extends RpcServer>(
  server: TServer,
  whenInitialized: () => Promise<void>,
  preInitChannels: ReadonlySet<string> = PRE_INIT_CHANNELS,
): TServer {
  const handle = (channel: string, handler: HandlerFn, options?: RpcHandlerOptions): void => {
    if (preInitChannels.has(channel)) {
      server.handle(channel, handler, options)
      return
    }
    server.handle(channel, async (ctx, ...args) => {
      await whenInitialized()
      return handler(ctx, ...args)
    }, options)
  }
  return new Proxy(server, {
    get(target, property) {
      if (property === 'handle') return handle
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
