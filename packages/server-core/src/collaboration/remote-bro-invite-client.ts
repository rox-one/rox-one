import {
  parseInviteUrl,
  type BroInviteCard,
  type JoinResult,
  type PresenceMember,
  requireRemoteSessionProjection,
  type RemoteSessionProjection,
  type SessionPublicationInput,
} from '@rox/shared/collaboration'

export class RemoteBroInvitationError extends Error {
  constructor(readonly code: 'membership_required' | 'forbidden' | 'invalid' | 'remote_unavailable') {
    super(code)
    this.name = 'RemoteBroInvitationError'
  }
}

export interface RemoteBroInviteClientOptions {
  /** Development/tests only. Public endpoints always require HTTPS. */
  allowLoopbackHttp?: boolean
  fetch?: typeof fetch
  timeoutMs?: number
}

const MAX_RESPONSE_BYTES = 65536

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteBroInvitationError('remote_unavailable')
  return value as Record<string, unknown>
}

function segment(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === '.' || value === '..') throw new RemoteBroInvitationError('invalid')
  return encodeURIComponent(value)
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new RemoteBroInvitationError('remote_unavailable')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_RESPONSE_BYTES) throw new RemoteBroInvitationError('remote_unavailable')
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { await reader.cancel().catch(() => {}) }
}

/** Host-only client. Bearer tokens are resolved for every call and never returned to UI. */
export class RemoteBroInviteClient {
  private readonly base: URL
  private readonly http: typeof fetch
  private readonly timeoutMs: number

  constructor(baseUrl: string, private readonly bearer: () => Promise<string | null>, options: RemoteBroInviteClientOptions = {}) {
    this.base = new URL(baseUrl)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname)
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/' ||
        (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && loopback && options.allowLoopbackHttp))) {
      throw new Error('Collaboration endpoint requires HTTPS or explicit loopback HTTP')
    }
    this.http = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 10000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) throw new Error('Invalid collaboration timeout')
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const token = await this.bearer()
    if (!token) throw new RemoteBroInvitationError('membership_required')
    try {
      const response = await this.http(new URL(path, this.base), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new RemoteBroInvitationError(response.status === 401 ? 'membership_required'
          : response.status === 403 ? 'forbidden' : response.status === 400 ? 'invalid' : 'remote_unavailable')
      }
      return await boundedJson(response)
    } catch (error) {
      if (error instanceof RemoteBroInvitationError) throw error
      throw new RemoteBroInvitationError('remote_unavailable')
    }
  }

  async invite(workspaceId: string, sessionId: string, role: 'editor' | 'viewer' = 'editor'): Promise<BroInviteCard> {
    const card = object(await this.request(`/v1/workspaces/${segment(workspaceId)}/sessions/${segment(sessionId)}/bro-invites`, { role }))
    const parsed = typeof card.url === 'string' ? parseInviteUrl(card.url) : null
    if (card.kind !== 'collaboration' || !parsed || parsed.sessionId !== sessionId || card.sessionId !== sessionId ||
        card.role !== role || typeof card.expiresAt !== 'number' || !Number.isFinite(card.expiresAt) ||
        card.qrPayload !== card.url || typeof card.contactShareText !== 'string') {
      throw new RemoteBroInvitationError('remote_unavailable')
    }
    return card as unknown as BroInviteCard
  }

  async publishSession(workspaceId: string, sessionId: string, input: SessionPublicationInput): Promise<RemoteSessionProjection> {
    try {
      const projection = requireRemoteSessionProjection(await this.request(`/v1/workspaces/${segment(workspaceId)}/sessions/${segment(sessionId)}/bro-publication`, input))
      if (projection.id !== sessionId || projection.workspaceId !== workspaceId) throw new RemoteBroInvitationError('remote_unavailable')
      return projection
    } catch (error) {
      if (error instanceof RemoteBroInvitationError) throw error
      throw new RemoteBroInvitationError('remote_unavailable')
    }
  }

  async readProjection(workspaceId: string, sessionId: string): Promise<RemoteSessionProjection> {
    try {
      const projection = requireRemoteSessionProjection(await this.request(`/v1/workspaces/${segment(workspaceId)}/sessions/${segment(sessionId)}/bro-projection`))
      if (projection.id !== sessionId || projection.workspaceId !== workspaceId) throw new RemoteBroInvitationError('remote_unavailable')
      return projection
    } catch (error) {
      if (error instanceof RemoteBroInvitationError) throw error
      throw new RemoteBroInvitationError('remote_unavailable')
    }
  }

  async join(url: string, workspaceId?: string): Promise<JoinResult> {
    const parsed = parseInviteUrl(url)
    if (!parsed) return { ok: false, error: 'invalid' }
    const result = object(await this.request('/v1/collaboration/bro-invites/join', { url, ...(workspaceId === undefined ? {} : { workspaceId: segment(workspaceId) }) }))
    if (result.ok === false && ['expired', 'revoked', 'reused', 'membership_required', 'invalid'].includes(String(result.error))) {
      return result as unknown as JoinResult
    }
    if (result.ok !== true || result.sessionId !== parsed.sessionId ||
        (result.role !== 'editor' && result.role !== 'viewer') || typeof result.accountId !== 'string' || !result.accountId ||
        typeof result.workspaceId !== 'string' || !result.workspaceId || workspaceId !== undefined && result.workspaceId !== workspaceId) throw new RemoteBroInvitationError('remote_unavailable')
    if (result.remoteSession !== undefined) {
      try {
        const projection = requireRemoteSessionProjection(result.remoteSession)
        if (projection.id !== result.sessionId || projection.workspaceId !== result.workspaceId) throw new Error('Invalid projection target')
        return { ...result, remoteSession: projection } as unknown as JoinResult
      } catch { throw new RemoteBroInvitationError('remote_unavailable') }
    }
    return result as unknown as JoinResult
  }

  async revoke(workspaceId: string, joinKey: string): Promise<{ success: boolean }> {
    if (!/^[a-f0-9]{32}$/.test(joinKey)) throw new RemoteBroInvitationError('invalid')
    const result = object(await this.request(`/v1/workspaces/${segment(workspaceId)}/bro-invites/${joinKey}/revoke`, {}))
    if (typeof result.success !== 'boolean') throw new RemoteBroInvitationError('remote_unavailable')
    return { success: result.success }
  }

  async listPresence(workspaceId: string, sessionId: string): Promise<PresenceMember[]> {
    const result = await this.request(`/v1/workspaces/${segment(workspaceId)}/sessions/${segment(sessionId)}/bro-presence`)
    if (!Array.isArray(result) || result.some(value => {
      const member = object(value)
      return typeof member.accountId !== 'string' || !member.accountId || typeof member.displayName !== 'string' ||
        typeof member.username !== 'string' || !['owner', 'editor', 'viewer'].includes(String(member.role)) ||
        !['online', 'away', 'offline'].includes(String(member.status)) ||
        typeof member.joinedAt !== 'number' || !Number.isFinite(member.joinedAt)
    })) throw new RemoteBroInvitationError('remote_unavailable')
    return result as PresenceMember[]
  }
}
