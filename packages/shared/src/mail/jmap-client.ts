/**
 * Minimal typed JMAP (RFC 8620/8621) client for Rox Mail.
 *
 * Talks to one configured Stalwart origin only: every URL the server returns
 * (apiUrl, uploadUrl, downloadUrl, eventSourceUrl) is resolved against the
 * configured base URL and rejected when it points at another origin, so the
 * mailbox secret is never sent anywhere else (same rule as Conation
 * `stalwart_jmap.rs`). Secrets are never logged or put into errors.
 */

export const JMAP_CORE = 'urn:ietf:params:jmap:core'
export const JMAP_MAIL = 'urn:ietf:params:jmap:mail'
export const JMAP_SUBMISSION = 'urn:ietf:params:jmap:submission'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface JmapAuth {
  /** e.g. http://127.0.0.1:8480 — scheme + host + optional port, no path. */
  baseUrl: string
  username: string
  /** App password (preferred) or account password. Never logged. */
  secret: string
}

export interface JmapSession {
  apiUrl: string
  uploadUrl: string
  downloadUrl: string
  eventSourceUrl: string
  username: string
  state: string
  primaryAccounts: Record<string, string>
  capabilities: Record<string, unknown>
  accounts: Record<string, { name: string; accountCapabilities?: Record<string, any> }>
}

export class JmapError extends Error {
  constructor(message: string, readonly code: 'auth' | 'network' | 'origin' | 'method' | 'http' | 'protocol', readonly status?: number) {
    super(message)
    this.name = 'JmapError'
  }
}

export type MethodCall = [string, Record<string, unknown>, string]
export type MethodResponse = [string, any, string]
/** Never empty (call() rejects an empty methodResponses). */
export type MethodResponses = [MethodResponse, ...MethodResponse[]]

export interface JmapMailbox {
  id: string
  name: string
  role: string | null
  parentId: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
}

export interface JmapAddress { name: string | null; email: string }

export interface JmapEmailSummary {
  id: string
  threadId: string
  mailboxIds: Record<string, boolean>
  keywords: Record<string, boolean>
  from: JmapAddress[] | null
  to: JmapAddress[] | null
  subject: string | null
  receivedAt: string
  preview: string
  hasAttachment: boolean
  size: number
}

export interface JmapBodyPart {
  partId?: string | null
  blobId?: string | null
  size?: number
  name?: string | null
  type?: string
  charset?: string | null
  disposition?: string | null
  cid?: string | null
}

export interface JmapEmailFull extends JmapEmailSummary {
  cc: JmapAddress[] | null
  bcc: JmapAddress[] | null
  replyTo: JmapAddress[] | null
  sentAt: string | null
  messageId: string[] | null
  inReplyTo: string[] | null
  references: string[] | null
  textBody: JmapBodyPart[]
  htmlBody: JmapBodyPart[]
  attachments: JmapBodyPart[]
  bodyValues: Record<string, { value: string; isTruncated?: boolean }>
}

export interface JmapIdentity { id: string; name: string; email: string }

export const SUMMARY_PROPERTIES = [
  'id', 'threadId', 'mailboxIds', 'keywords', 'from', 'to', 'subject', 'receivedAt', 'preview', 'hasAttachment', 'size',
] as const

export const FULL_PROPERTIES = [
  ...SUMMARY_PROPERTIES, 'cc', 'bcc', 'replyTo', 'sentAt', 'messageId', 'inReplyTo', 'references',
  'textBody', 'htmlBody', 'attachments', 'bodyValues',
] as const

export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new JmapError('Mail server URL is not a valid URL', 'origin')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new JmapError('Mail server URL must be http(s)', 'origin')
  if (url.username || url.password || url.search || url.hash) throw new JmapError('Mail server URL must not contain credentials, query or fragment', 'origin')
  // Plain http only for loopback (local dev server). Anything else must be https.
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !loopback) throw new JmapError('Plain http is allowed only for a local (loopback) mail server', 'origin')
  return url.origin
}

/** Resolve a server-provided URL against the configured origin; refuse other origins. */
export function resolveSameOrigin(baseUrl: string, candidate: string): string {
  const resolved = new URL(candidate, baseUrl + '/')
  if (resolved.origin !== new URL(baseUrl).origin) {
    throw new JmapError('JMAP server pointed to a different origin; refusing to send credentials there', 'origin')
  }
  return resolved.toString()
}

function basic(username: string, secret: string): string {
  const raw = `${username}:${secret}`
  return 'Basic ' + (typeof Buffer !== 'undefined' ? Buffer.from(raw, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(raw))))
}

export class JmapClient {
  readonly baseUrl: string
  private readonly auth: JmapAuth
  private readonly fetchImpl: FetchLike
  private sessionCache: JmapSession | null = null
  private readonly timeoutMs: number

  constructor(auth: JmapAuth, opts: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.baseUrl = normalizeBaseUrl(auth.baseUrl)
    this.auth = { ...auth, baseUrl: this.baseUrl }
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = opts.timeoutMs ?? 15_000
  }

  get authorization(): string {
    return basic(this.auth.username, this.auth.secret)
  }

  private async request(url: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        signal: init.signal ?? controller.signal,
        headers: { Authorization: this.authorization, ...(init.headers as Record<string, string> | undefined) },
      })
      if (res.status === 401 || res.status === 403) throw new JmapError('Mail server rejected the credentials', 'auth', res.status)
      return res
    } catch (error) {
      if (error instanceof JmapError) throw error
      throw new JmapError(`Mail server is unreachable (${(error as Error)?.name === 'AbortError' ? 'timeout' : 'network'})`, 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  async session(force = false): Promise<JmapSession> {
    if (this.sessionCache && !force) return this.sessionCache
    const res = await this.request(`${this.baseUrl}/jmap/session`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new JmapError(`JMAP session failed: HTTP ${res.status}`, 'http', res.status)
    const body = (await res.json()) as JmapSession
    if (!body?.apiUrl || !body.primaryAccounts) throw new JmapError('JMAP session response is malformed', 'protocol')
    this.sessionCache = body
    return body
  }

  async accountId(capability = JMAP_MAIL): Promise<string> {
    const s = await this.session()
    const id = s.primaryAccounts[capability]
    if (!id) throw new JmapError(`No primary account for ${capability}`, 'protocol')
    return id
  }

  async call(methodCalls: MethodCall[], using: string[] = [JMAP_CORE, JMAP_MAIL, JMAP_SUBMISSION]): Promise<MethodResponses> {
    const s = await this.session()
    const url = resolveSameOrigin(this.baseUrl, s.apiUrl)
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ using, methodCalls }),
    })
    if (!res.ok) throw new JmapError(`JMAP request failed: HTTP ${res.status}`, 'http', res.status)
    const body = (await res.json()) as { methodResponses?: MethodResponse[] }
    if (!Array.isArray(body?.methodResponses) || body.methodResponses.length === 0) throw new JmapError('JMAP response is malformed', 'protocol')
    for (const [name, args] of body.methodResponses) {
      if (name === 'error') throw new JmapError(`JMAP method error: ${args?.type ?? 'unknown'}${args?.description ? ` — ${args.description}` : ''}`, 'method')
    }
    return body.methodResponses as MethodResponses
  }

  // ---------------------------------------------------------------- mail ops

  async mailboxes(): Promise<JmapMailbox[]> {
    const accountId = await this.accountId()
    const [first] = await this.call([['Mailbox/get', { accountId, properties: ['id', 'name', 'role', 'parentId', 'sortOrder', 'totalEmails', 'unreadEmails'] }, 'm']])
    const res = first?.[1] ?? {}
    return (res.list ?? []) as JmapMailbox[]
  }

  async mailboxByRole(role: string): Promise<JmapMailbox | null> {
    return (await this.mailboxes()).find((m) => m.role === role) ?? null
  }

  async queryEmails(opts: { mailboxId?: string; text?: string; limit?: number; position?: number; notInMailboxIds?: string[] } = {}): Promise<{ ids: string[]; total: number; emails: JmapEmailSummary[]; queryState: string }> {
    const accountId = await this.accountId()
    const filter: Record<string, unknown> = {}
    if (opts.mailboxId) filter.inMailbox = opts.mailboxId
    if (opts.text?.trim()) filter.text = opts.text.trim()
    if (opts.notInMailboxIds?.length) filter.inMailboxOtherThan = opts.notInMailboxIds
    const responses = await this.call([
      ['Email/query', { accountId, filter, sort: [{ property: 'receivedAt', isAscending: false }], position: opts.position ?? 0, limit: opts.limit ?? 50, calculateTotal: true }, 'q'],
      ['Email/get', { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: [...SUMMARY_PROPERTIES] }, 'g'],
    ])
    const q = responses.find((r) => r[2] === 'q')![1]
    const g = responses.find((r) => r[2] === 'g')![1]
    const byId = new Map<string, JmapEmailSummary>((g.list ?? []).map((e: JmapEmailSummary) => [e.id, e]))
    return { ids: q.ids ?? [], total: q.total ?? 0, queryState: q.queryState ?? '', emails: (q.ids ?? []).map((id: string) => byId.get(id)).filter(Boolean) as JmapEmailSummary[] }
  }

  async getEmail(id: string): Promise<JmapEmailFull | null> {
    const accountId = await this.accountId()
    const [[, res]] = await this.call([['Email/get', {
      accountId, ids: [id], properties: [...FULL_PROPERTIES],
      fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 1_000_000,
    }, 'e']])
    return (res.list?.[0] as JmapEmailFull | undefined) ?? null
  }

  async updateEmails(patches: Record<string, Record<string, unknown>>): Promise<{ updated: string[]; notUpdated: Record<string, unknown> }> {
    const accountId = await this.accountId()
    const [[, res]] = await this.call([['Email/set', { accountId, update: patches }, 'u']])
    return { updated: Object.keys(res.updated ?? {}), notUpdated: res.notUpdated ?? {} }
  }

  async setKeyword(ids: string[], keyword: '$seen' | '$flagged', on: boolean) {
    return this.updateEmails(Object.fromEntries(ids.map((id) => [id, { [`keywords/${keyword}`]: on ? true : null }])))
  }

  async moveEmails(ids: string[], toMailboxId: string) {
    return this.updateEmails(Object.fromEntries(ids.map((id) => [id, { mailboxIds: { [toMailboxId]: true } }])))
  }

  async destroyEmails(ids: string[]): Promise<string[]> {
    const accountId = await this.accountId()
    const [[, res]] = await this.call([['Email/set', { accountId, destroy: ids }, 'd']])
    return res.destroyed ?? []
  }

  async identities(): Promise<JmapIdentity[]> {
    const accountId = await this.accountId(JMAP_SUBMISSION)
    const [[, res]] = await this.call([['Identity/get', { accountId }, 'i']])
    return (res.list ?? []) as JmapIdentity[]
  }

  async ensureIdentity(email: string, name: string): Promise<JmapIdentity> {
    const existing = (await this.identities()).find((i) => i.email.toLowerCase() === email.toLowerCase())
    const accountId = await this.accountId(JMAP_SUBMISSION)
    if (existing) {
      // Stalwart seeds the default identity name from the account description
      // (our "rox:<uuid>" owner marker) — never let that leak into From.
      if (existing.name !== name) {
        await this.call([['Identity/set', { accountId, update: { [existing.id]: { name } } }, 'u']]).catch(() => undefined)
      }
      return { ...existing, name }
    }
    const [[, res]] = await this.call([['Identity/set', { accountId, create: { i: { email, name } } }, 'c']])
    const created = res.created?.i
    if (!created?.id) throw new JmapError('Could not create a sending identity', 'method')
    return { id: created.id, email, name }
  }

  async upload(bytes: Uint8Array, type: string): Promise<{ blobId: string; size: number; type: string }> {
    const s = await this.session()
    const accountId = await this.accountId()
    const url = resolveSameOrigin(this.baseUrl, s.uploadUrl.replace('{accountId}', encodeURIComponent(accountId)))
    const res = await this.request(url, { method: 'POST', headers: { 'Content-Type': type || 'application/octet-stream' }, body: bytes as unknown as RequestInit['body'] }, 60_000)
    if (!res.ok) throw new JmapError(`Upload failed: HTTP ${res.status}`, 'http', res.status)
    return (await res.json()) as { blobId: string; size: number; type: string }
  }

  async download(blobId: string, name: string, type: string): Promise<Uint8Array> {
    const s = await this.session()
    const accountId = await this.accountId()
    const path = s.downloadUrl
      .replace('{accountId}', encodeURIComponent(accountId))
      .replace('{blobId}', encodeURIComponent(blobId))
      .replace('{name}', encodeURIComponent(name || 'attachment'))
      .replace('{type}', encodeURIComponent(type || 'application/octet-stream'))
    const res = await this.request(resolveSameOrigin(this.baseUrl, path), {}, 60_000)
    if (!res.ok) throw new JmapError(`Download failed: HTTP ${res.status}`, 'http', res.status)
    return new Uint8Array(await res.arrayBuffer())
  }

  /**
   * Create a draft and (optionally) submit it in one request.
   * Draft lives in Drafts with $draft; on successful submission it moves to Sent.
   */
  async compose(input: ComposeInput & { send: boolean }): Promise<{ emailId: string; submissionId?: string }> {
    const accountId = await this.accountId()
    const boxes = await this.mailboxes()
    const drafts = boxes.find((m) => m.role === 'drafts')
    const sent = boxes.find((m) => m.role === 'sent')
    if (!drafts) throw new JmapError('Drafts mailbox is missing', 'protocol')
    const email: Record<string, unknown> = {
      mailboxIds: { [drafts.id]: true },
      keywords: { $draft: true, $seen: true },
      from: [input.from],
      to: input.to,
      subject: input.subject,
      bodyValues: { t: { value: input.text } },
      textBody: [{ partId: 't', type: 'text/plain' }],
    }
    if (input.cc?.length) email.cc = input.cc
    if (input.bcc?.length) email.bcc = input.bcc
    if (input.inReplyTo?.length) email.inReplyTo = input.inReplyTo
    if (input.references?.length) email.references = input.references
    if (input.html) {
      ;(email.bodyValues as Record<string, unknown>).h = { value: input.html }
      email.htmlBody = [{ partId: 'h', type: 'text/html' }]
    }
    if (input.attachments?.length) {
      email.attachments = input.attachments.map((a) => ({ blobId: a.blobId, type: a.type, name: a.name, size: a.size, disposition: 'attachment' }))
    }
    const calls: MethodCall[] = []
    if (input.replaceDraftId) calls.push(['Email/set', { accountId, destroy: [input.replaceDraftId] }, 'x'])
    calls.push(['Email/set', { accountId, create: { draft: email } }, 'c'])
    if (input.send) {
      if (!input.identityId) throw new JmapError('Sending identity is missing', 'protocol')
      const onSuccess: Record<string, unknown> = { 'keywords/$draft': null, [`mailboxIds/${drafts.id}`]: null }
      if (sent) onSuccess[`mailboxIds/${sent.id}`] = true
      calls.push(['EmailSubmission/set', {
        accountId,
        create: { sub: { identityId: input.identityId, emailId: '#draft' } },
        onSuccessUpdateEmail: { '#sub': onSuccess },
      }, 's'])
    }
    const responses = await this.call(calls)
    const created = responses.find((r) => r[2] === 'c')![1]
    const emailId = created.created?.draft?.id as string | undefined
    if (!emailId) throw new JmapError(`Could not save the message: ${describeSetError(created.notCreated?.draft)}`, 'method')
    if (!input.send) return { emailId }
    const sub = responses.find((r) => r[2] === 's')?.[1]
    const submissionId = sub?.created?.sub?.id as string | undefined
    if (!submissionId) throw new JmapError(`Message saved to Drafts but not sent: ${describeSetError(sub?.notCreated?.sub)}`, 'method')
    return { emailId, submissionId }
  }

  /**
   * Server push over JMAP EventSource (RFC 8620 §7.3), parsed from a
   * streaming fetch so it works in Node/Electron main without a polyfill.
   * Returns a stop() function. Reconnects with backoff until stopped.
   */
  subscribe(onChange: (changed: Record<string, Record<string, string>>) => void, opts: { onStatus?: (s: 'open' | 'retry') => void } = {}): () => void {
    let stopped = false
    let controller: AbortController | null = null
    let attempt = 0
    const loop = async () => {
      while (!stopped) {
        try {
          const s = await this.session()
          const url = resolveSameOrigin(this.baseUrl, s.eventSourceUrl
            .replace('{types}', 'Email,Mailbox,EmailDelivery')
            .replace('{closeafter}', 'no')
            .replace('{ping}', '30'))
          controller = new AbortController()
          const res = await this.fetchImpl(url, { headers: { Authorization: this.authorization, Accept: 'text/event-stream' }, signal: controller.signal })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          attempt = 0
          opts.onStatus?.('open')
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          while (!stopped) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            let idx: number
            while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
              const raw = buf.slice(0, idx)
              buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
              const lines = raw.split(/\r?\n/)
              const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message'
              const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
              if (event === 'state' && data) {
                try {
                  const parsed = JSON.parse(data) as { changed?: Record<string, Record<string, string>> }
                  if (parsed.changed) onChange(parsed.changed)
                } catch { /* ignore malformed frame */ }
              }
            }
          }
        } catch {
          /* fall through to retry */
        }
        if (stopped) break
        opts.onStatus?.('retry')
        attempt = Math.min(attempt + 1, 6)
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)))
      }
    }
    void loop()
    return () => {
      stopped = true
      controller?.abort()
    }
  }
}

export interface ComposeInput {
  from: JmapAddress
  to: JmapAddress[]
  cc?: JmapAddress[]
  bcc?: JmapAddress[]
  subject: string
  text: string
  html?: string
  inReplyTo?: string[]
  references?: string[]
  attachments?: Array<{ blobId: string; type: string; name: string; size: number }>
  identityId?: string
  /** Destroy this previous draft version in the same request (autosave). */
  replaceDraftId?: string
}

export function describeSetError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown error'
  const e = err as { type?: string; description?: string }
  return [e.type, e.description].filter(Boolean).join(': ') || 'unknown error'
}

/** Parse "Name <a@b>" / "a@b, c@d" into JMAP addresses. */
export function parseAddressList(raw: string): JmapAddress[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*<([^>]+)>$/)
      const email = (m?.[2] ?? part).trim()
      const name = m ? (m[1] ?? '').replace(/^"|"$/g, '').trim() || null : null
      return { name, email }
    })
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))
}
