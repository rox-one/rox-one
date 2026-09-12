/**
 * Harness IPC names ↔ live RPC channels.
 *
 * `sessions:get` is the collection list (there is no get-by-id RPC).
 * Per-session cache hits stay on the synthetic `sessions.get` name.
 */
export const HARNESS_IPC_ALIASES: Record<string, string> = {
  'sessions.list': 'sessions:get',
  'sessions.permission': 'sessions:getPermissionModeState',
  'sessions.metadata': 'sessions:getProvenance',
  'sessions.messages': 'sessions:getMessages',
}

export const RPC_TO_HARNESS: Record<string, string> = {
  'sessions:get': 'sessions.list',
  'sessions:getPermissionModeState': 'sessions.permission',
  'sessions:getProvenance': 'sessions.metadata',
  'sessions:getMessages': 'sessions.messages',
}

export const SESSION_API_TO_HARNESS = {
  getSessions: 'sessions.list',
  getSessionPermissionModeState: 'sessions.permission',
  getSessionProvenance: 'sessions.metadata',
  getSessionMessages: 'sessions.messages',
} as const

export type SessionApiName = keyof typeof SESSION_API_TO_HARNESS

export function normalizeIpcChannel(channel: string): string {
  return RPC_TO_HARNESS[channel] ?? channel
}
