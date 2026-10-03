/** Read-only references. Runtime RPC remains responsible for workspace/session authorization. */
export interface RuntimeMapLinkRequest {
  sessionId: string
  rootRunId: string
  eventId: string
}

const validIdentity = (value: string | null): value is string =>
  value !== null && /^[A-Za-z0-9._:-]{1,200}$/.test(value) && value !== '.' && value !== '..'
const validEvent = (value: string | null): value is string =>
  value !== null && value.length > 0 && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value)
const exactlyOne = (query: URLSearchParams, key: string) => query.getAll(key).length === 1

export function parseRuntimeMapLinkUrl(parsed: URL): { workspaceId: string; view: string } | null {
  if (parsed.hostname !== 'runtime' || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.hash) return null
  const query = parsed.searchParams
  if (!['workspace', 'session', 'run', 'event'].every(key => exactlyOne(query, key))) return null
  if ([...query.keys()].some(key => !['workspace', 'session', 'run', 'event', 'window', 'sidebar'].includes(key))) return null
  const workspaceId = query.get('workspace'), sessionId = query.get('session'), rootRunId = query.get('run'), eventId = query.get('event')
  if (!validIdentity(workspaceId) || !validIdentity(sessionId) || !validIdentity(rootRunId) || !validEvent(eventId)) return null
  const selection = new URLSearchParams({ runtimeRun: rootRunId, runtimeEvent: eventId })
  return { workspaceId, view: `allSessions/session/${encodeURIComponent(sessionId)}?${selection}` }
}

export function parseRuntimeMapViewRequest(route: string): RuntimeMapLinkRequest | null {
  try {
    if (route.length > 26000 || route.includes('#')) return null
    // Reject malformed encodings before URLSearchParams can silently repair them.
    decodeURIComponent(route)
    const match = /^allSessions\/session\/([^/?]+)\?([^#]+)$/.exec(route)
    if (!match) return null
    const query = new URLSearchParams(match[2])
    if (!['runtimeRun', 'runtimeEvent'].every(key => exactlyOne(query, key))) return null
    const sessionId = decodeURIComponent(match[1]), rootRunId = query.get('runtimeRun'), eventId = query.get('runtimeEvent')
    if (!validIdentity(sessionId) || !validIdentity(rootRunId) || !validEvent(eventId)) return null
    return { sessionId, rootRunId, eventId }
  } catch { return null }
}
