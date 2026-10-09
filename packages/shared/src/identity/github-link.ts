/**
 * Typed client for GitHub identity linking («Привязать GitHub»).
 *
 * Transport-only: the caller hands in a transport (the Electron bridge in the
 * desktop app) and this module validates every response into a closed shape.
 * The device-flow access token never crosses this boundary — a response that
 * echoes `access_token`/`accessToken`/`device_code`/`deviceCode` is rejected
 * outright, and no secret appears in an error message.
 *
 * Wire contract (fabric channels; host-local):
 *   start()                              → { flowId, userCode, verificationUri, interval, expiresIn? }
 *   poll({ flowId, workspaceId })        → pending | slow_down | denied | expired | linked(profile)
 *   get({ workspaceId })                 → profile | null
 */

export interface GithubLinkProfile {
  /** Public GitHub handle, e.g. `octocat`. */
  githubLogin: string
  /** Immutable numeric GitHub id (the stable subject). */
  githubId: number
  /** Avatar URL from the GitHub profile. */
  avatarUrl: string
  /** Epoch milliseconds when the link landed. */
  linkedAt: number
}

export interface GithubLinkStart {
  /** Opaque flow id used by poll. */
  flowId: string
  /** Code the user types at github.com/login/device. */
  userCode: string
  /** Verification page to open in the browser. */
  verificationUri: string
  /** Seconds GitHub asks us to wait between polls. */
  interval: number
  /** Seconds until the device code expires, when GitHub reports it. */
  expiresIn?: number
}

export type GithubLinkPoll =
  | { status: 'pending'; interval?: number }
  | { status: 'slow_down'; interval?: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'linked'; profile: GithubLinkProfile }

export type GithubLinkErrorCode = 'network' | 'invalid_response' | 'unavailable'

/** Error carrying a stable, log-safe code. Never embeds a token or code. */
export class GithubLinkError extends Error {
  readonly code: GithubLinkErrorCode

  constructor(code: GithubLinkErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'GithubLinkError'
    this.code = code
  }
}

/** Minimal bridge surface; the desktop preload provides it. */
export interface GithubLinkTransport {
  start(): Promise<unknown>
  poll(input: { flowId: string; workspaceId: string }): Promise<unknown>
  get(input: { workspaceId: string }): Promise<unknown>
}

export interface GithubLinkClient {
  start(): Promise<GithubLinkStart>
  poll(flowId: string, workspaceId: string): Promise<GithubLinkPoll>
  get(workspaceId: string): Promise<GithubLinkProfile | null>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requireString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** A view must never carry the device flow's private material. */
function assertNoSecret(value: unknown): void {
  const json = JSON.stringify(value)
  if (
    /"access_token"\s*:/i.test(json)
    || /"accessToken"\s*:/i.test(json)
    || /"device_code"\s*:/i.test(json)
    || /"deviceCode"\s*:/i.test(json)
  ) {
    throw new GithubLinkError('invalid_response')
  }
}

export function parseGithubLinkStart(data: unknown): GithubLinkStart {
  assertNoSecret(data)
  const record = asRecord(data)
  const flowId = requireString(record, 'flowId')
  const userCode = requireString(record, 'userCode')
  const verificationUri = requireString(record, 'verificationUri')
  const interval = record?.interval
  if (!flowId || !userCode || !verificationUri || typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
    throw new GithubLinkError('invalid_response')
  }
  const expiresIn = record?.expiresIn
  return {
    flowId,
    userCode,
    verificationUri,
    interval,
    ...(typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? { expiresIn } : {}),
  }
}

export function parseGithubLinkProfile(data: unknown): GithubLinkProfile {
  assertNoSecret(data)
  const record = asRecord(data)
  const githubLogin = requireString(record, 'githubLogin')
  const githubId = record?.githubId
  const avatarUrl = requireString(record, 'avatarUrl')
  const linkedAt = record?.linkedAt
  if (
    !githubLogin
    || typeof githubId !== 'number' || !Number.isFinite(githubId)
    || !avatarUrl
    || typeof linkedAt !== 'number' || !Number.isFinite(linkedAt)
  ) {
    throw new GithubLinkError('invalid_response')
  }
  return { githubLogin, githubId, avatarUrl, linkedAt }
}

export function parseGithubLinkPoll(data: unknown): GithubLinkPoll {
  assertNoSecret(data)
  const record = asRecord(data)
  const status = record?.status
  if (status === 'pending' || status === 'slow_down') {
    const interval = record?.interval
    return {
      status,
      ...(typeof interval === 'number' && Number.isFinite(interval) ? { interval } : {}),
    }
  }
  if (status === 'denied' || status === 'expired') return { status }
  if (status === 'linked') return { status: 'linked', profile: parseGithubLinkProfile(record?.profile) }
  throw new GithubLinkError('invalid_response')
}

async function call<T>(run: () => Promise<unknown>, parse: (data: unknown) => T): Promise<T> {
  let data: unknown
  try {
    data = await run()
  } catch (error) {
    if (error instanceof GithubLinkError) throw error
    throw new GithubLinkError('network')
  }
  return parse(data)
}

export function createGithubLinkClient(transport: GithubLinkTransport): GithubLinkClient {
  return {
    start: () => call(() => transport.start(), parseGithubLinkStart),
    poll: (flowId, workspaceId) => {
      if (!flowId) throw new GithubLinkError('invalid_response', 'missing flow id')
      return call(() => transport.poll({ flowId, workspaceId }), parseGithubLinkPoll)
    },
    get: (workspaceId) => call(() => transport.get({ workspaceId }), data => {
      if (data === null || data === undefined) return null
      return parseGithubLinkProfile(data)
    }),
  }
}

/** The subset of the Electron bridge this flow relies on. */
export interface GithubLinkBridgeApi {
  fabricGithubLinkStart(): Promise<unknown>
  fabricGithubLinkPoll(input: { flowId: string; workspaceId: string }): Promise<unknown>
  fabricGithubLinkGet(input: { workspaceId: string }): Promise<unknown>
}

export function isGithubLinkBridge(value: unknown): value is GithubLinkBridgeApi {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.fabricGithubLinkStart === 'function'
    && typeof record.fabricGithubLinkPoll === 'function'
    && typeof record.fabricGithubLinkGet === 'function'
}

/** Adapts the Electron bridge (main owns the token) to the client surface. */
export function createBridgeGithubLinkClient(value: unknown): GithubLinkClient | undefined {
  if (!isGithubLinkBridge(value)) return undefined
  const bridge = value
  return createGithubLinkClient({
    start: () => bridge.fabricGithubLinkStart(),
    poll: input => bridge.fabricGithubLinkPoll(input),
    get: input => bridge.fabricGithubLinkGet(input),
  })
}