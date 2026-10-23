/**
 * Thin workspace-service `/v1/im/*` client for Rox Calls (messenger contract v1.1).
 *
 * Used before LiveKit mint (membership), after call lifecycle (service-events),
 * and for «О канале» presence. When the bridge is unconfigured or `/im` is
 * unreachable (network, 502, pre-#2196 404 on an unmounted router), every call
 * fails closed to the local team-chat store — never throws into the call path.
 *
 * Auth: host-injected bearer (actor JWT). Tokens are never logged or returned.
 */
import { readCallSettings } from './call-credentials.ts'

export type ImMembershipVerdict = 'member' | 'not-member' | 'unavailable'
export type ImPresenceStatus = 'online' | 'away' | 'offline'

export interface ImPresenceEntry {
  userId: string
  status: ImPresenceStatus
  lastSeenAt?: number
}

export type ImServiceEventPayload =
  | { type: 'call.started'; roomName: string; callId: string; startedBy?: string; ts: number }
  | { type: 'call.ended'; roomName: string; callId: string; durationSec: number; participants: string[] }
  | { type: 'call.transcript'; roomName: string; callId: string; transcriptUrl: string; summary?: string }

export interface ImBridgeTransport {
  /** Workspace-service origin (`https://…`), or null when local-only. */
  baseUrl(): string | null | Promise<string | null>
  /** Actor JWT; null skips remote. Never log the value. */
  token(): string | null | Promise<string | null>
  fetch?: typeof fetch
  timeoutMs?: number
}

const MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 8_000

let injected: ImBridgeTransport | null = null

/** Host (Electron / headless) installs the bearer + base URL once at boot. */
export function setImBridgeTransport(transport: ImBridgeTransport | null): void {
  injected = transport
}

export function getImBridgeTransport(): ImBridgeTransport | null {
  return injected
}

/**
 * Env / team-calls.json config for the workspace-service origin.
 * Token never comes from the settings file — only from the injected transport
 * or (tests/dev) `ROX_WORKSPACE_SERVICE_TOKEN`.
 */
export function resolveImBridgeBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const fromEnv = env.ROX_WORKSPACE_SERVICE_URL?.trim()
  if (fromEnv) return stripTrailingSlash(fromEnv)
  const fromFile = readCallSettings().workspaceServiceUrl?.trim()
  return fromFile ? stripTrailingSlash(fromFile) : null
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function defaultTransportFromEnv(
  env: Record<string, string | undefined> = process.env,
): ImBridgeTransport | null {
  const baseUrl = resolveImBridgeBaseUrl(env)
  if (!baseUrl) return null
  return {
    baseUrl: () => baseUrl,
    token: () => env.ROX_WORKSPACE_SERVICE_TOKEN?.trim() || null,
  }
}

function activeTransport(): ImBridgeTransport | null {
  return injected ?? defaultTransportFromEnv()
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        return undefined
      }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
}

function segment(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) return ''
  return encodeURIComponent(value)
}

type RemoteResult =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'unavailable' }

async function imFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<RemoteResult> {
  const transport = activeTransport()
  if (!transport) return { kind: 'unavailable' }
  let origin: string | null
  let token: string | null
  try {
    origin = await transport.baseUrl()
    token = await transport.token()
  } catch {
    return { kind: 'unavailable' }
  }
  if (!origin || !token) return { kind: 'unavailable' }
  let url: URL
  try {
    url = new URL(path, origin.endsWith('/') ? origin : origin + '/')
  } catch {
    return { kind: 'unavailable' }
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return { kind: 'unavailable' }
  }
  const fetchImpl = transport.fetch ?? fetch
  const timeoutMs = transport.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    // 502 / 5xx / unmounted router → treat as unavailable so Calls keep working
    // on the local store until Messenger #2196 lights up /im.
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => {})
      return { kind: 'unavailable' }
    }
    const parsed = await boundedJson(response)
    return { kind: 'ok', status: response.status, body: parsed }
  } catch {
    return { kind: 'unavailable' }
  }
}

/**
 * Contract: GET /v1/im/channels/:channelId/members/:userId
 * 200 → member; 403 → actor cannot probe / not allowed; 404 → not a member
 * *or* `/im` not mounted yet. 404 is treated as unavailable (local fallback)
 * so pre-merge hosts keep working; 403 is a definitive remote deny.
 */
export async function checkImChannelMembership(
  channelId: string,
  userId: string,
): Promise<ImMembershipVerdict> {
  const ch = segment(channelId)
  const uid = segment(userId)
  if (!ch || !uid) return 'unavailable'
  const result = await imFetch('GET', `/v1/im/channels/${ch}/members/${uid}`)
  if (result.kind === 'unavailable') return 'unavailable'
  if (result.status === 200) return 'member'
  if (result.status === 403) return 'not-member'
  // 404 and anything else: prefer local membership until /im is authoritative.
  return 'unavailable'
}

/**
 * Contract: POST /v1/im/channels/:channelId/service-events
 * Best-effort; returns whether the remote accepted (created or idempotent hit).
 */
export async function publishImServiceEvent(
  channelId: string,
  event: ImServiceEventPayload,
): Promise<'published' | 'duplicate' | 'unavailable'> {
  const ch = segment(channelId)
  if (!ch) return 'unavailable'
  const result = await imFetch('POST', `/v1/im/channels/${ch}/service-events`, event)
  if (result.kind === 'unavailable') return 'unavailable'
  if (result.status === 201) return 'published'
  if (result.status === 200) return 'duplicate'
  return 'unavailable'
}

/**
 * Contract: GET /v1/im/presence?userIds=
 * Returns null when remote is unavailable (caller applies in-call + self fallback).
 */
export async function fetchImPresence(userIds: readonly string[]): Promise<ImPresenceEntry[] | null> {
  const ids = [...new Set(userIds.map(id => id.trim()).filter(Boolean))].slice(0, 100)
  if (ids.length === 0) return []
  if (ids.some(id => !segment(id))) return null
  const result = await imFetch('GET', `/v1/im/presence?userIds=${ids.map(segment).join(',')}`)
  if (result.kind === 'unavailable') return null
  if (result.status !== 200 || !Array.isArray(result.body)) return null
  const out: ImPresenceEntry[] = []
  for (const row of result.body) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const rec = row as Record<string, unknown>
    if (typeof rec.userId !== 'string' || !rec.userId) continue
    const status = rec.status === 'online' || rec.status === 'away' || rec.status === 'offline' ? rec.status : null
    if (!status) continue
    const entry: ImPresenceEntry = { userId: rec.userId, status }
    if (typeof rec.lastSeenAt === 'number' && Number.isFinite(rec.lastSeenAt)) entry.lastSeenAt = rec.lastSeenAt
    out.push(entry)
  }
  return out
}

/** Fire-and-forget wrapper — never rejects into the call lifecycle. */
export function publishImServiceEventBestEffort(
  channelId: string,
  event: ImServiceEventPayload,
): void {
  void publishImServiceEvent(channelId, event).catch(() => {})
}
