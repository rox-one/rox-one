import { RPC_CHANNELS } from '@rox/shared/protocol'
import { isSafeThemeId } from '@rox/shared/config/theme-id'

/** Existing appearance RPCs only. This does not grant desktop/native authority. */
export const WEBUI_APPEARANCE_CHANNELS: ReadonlySet<string> = new Set([
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME,
])

export function isWebThemeId(value: unknown): value is string {
  return isSafeThemeId(value)
}

export function validWebThemePreferences(value: unknown): value is {
  mode: string; colorTheme: string; font: string; contrast?: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.mode === 'string' && ['system', 'light', 'dark'].includes(v.mode)
    && isWebThemeId(v.colorTheme)
    && typeof v.font === 'string' && ['rox', 'inter', 'system'].includes(v.font)
    && (v.contrast === undefined || typeof v.contrast === 'string' && ['system', 'normal', 'high'].includes(v.contrast))
}

/** Validate before filesystem or workspace handlers see untrusted arguments. */
export function validWebAppearanceArguments(channel: string, arguments_: unknown, workspaceId: string): boolean {
  if (!Array.isArray(arguments_)) return false
  switch (channel) {
    case RPC_CHANNELS.theme.GET_APP:
    case RPC_CHANNELS.theme.GET_PRESETS:
    case RPC_CHANNELS.theme.GET_COLOR_THEME:
    case RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES:
      return arguments_.length === 0
    case RPC_CHANNELS.theme.LOAD_PRESET:
    case RPC_CHANNELS.theme.SET_COLOR_THEME:
      return arguments_.length === 1 && isWebThemeId(arguments_[0])
    case RPC_CHANNELS.theme.BROADCAST_PREFERENCES:
      return arguments_.length === 1 && validWebThemePreferences(arguments_[0])
    case RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME:
      return arguments_.length === 1 && arguments_[0] === workspaceId
    case RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME:
    case RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME:
      return arguments_.length === 2 && arguments_[0] === workspaceId
        && (arguments_[1] === null || isWebThemeId(arguments_[1]))
    default:
      return false
  }
}
