/**
 * PERF shell-from-cache — last successful desktop boot binding.
 *
 * The window may paint before the local WS server is listening. Main already
 * owns the workspace id via `__get-workspace-id` (sync). Caching the last
 * successful `{ workspaceId, authority }` lets the renderer paint shell chrome
 * under the splash (`shell-warming`) instead of blocking the whole tree on
 * identity/RPC probes that still wait for `__await-ws-port`.
 *
 * Auth is never skipped: initialize still revalidates identity/setup over the
 * transport and demotes to onboarding / transport-unavailable when needed.
 */
import * as storage from './local-storage'

export type StartupShellAuthority = 'local' | 'native'

export type StartupShellCache = {
  workspaceId: string
  authority: StartupShellAuthority
}

function isAuthority(value: unknown): value is StartupShellAuthority {
  return value === 'local' || value === 'native'
}

/** Parse a raw cache value; rejects malformed or empty entries. */
export function parseStartupShellCache(raw: unknown): StartupShellCache | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const workspaceId = record.workspaceId
  const authority = record.authority
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) return null
  if (!isAuthority(authority)) return null
  return { workspaceId, authority }
}

export function readStartupShellCache(): StartupShellCache | null {
  return parseStartupShellCache(storage.get<unknown>(storage.KEYS.startupShellCache, null))
}

export function writeStartupShellCache(entry: StartupShellCache): void {
  const parsed = parseStartupShellCache(entry)
  if (!parsed) return
  storage.set(storage.KEYS.startupShellCache, parsed)
}

export function clearStartupShellCache(): void {
  storage.remove(storage.KEYS.startupShellCache)
}

/**
 * Paint only when the sync window binding matches the last successful boot.
 * A mismatched or missing binding falls through to the loading splash.
 */
export function canPaintShellFromCache(
  cache: StartupShellCache | null,
  boundWorkspaceId: string | null | undefined,
): cache is StartupShellCache {
  if (!cache) return false
  if (typeof boundWorkspaceId !== 'string' || !boundWorkspaceId) return false
  return cache.workspaceId === boundWorkspaceId
}
