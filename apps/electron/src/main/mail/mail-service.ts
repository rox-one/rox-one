/**
 * Rox Mail bridge (main process): configuration, mailbox provisioning on the
 * configured Stalwart server, JMAP mail operations and push.
 *
 * Local pilot: the server is Stalwart on 127.0.0.1 (see docs/mail-local-stalwart.md).
 * Provisioning with admin rights is allowed only for a loopback server — the
 * admin credential comes from the macOS Keychain; for a production server the
 * rox.one backend provisions (signup hook) and hands out the device
 * credential instead. The mailbox app password is stored via
 * CredentialManager (encrypted store, master key in Keychain) and never
 * leaves this process.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  JmapClient,
  JmapError,
  normalizeBaseUrl,
  parseAddressList,
  provisionMailbox,
  type MailboxRecord,
  type MailboxSecretStore,
} from '@rox/shared/mail'
import {
  MAIL_DEFAULT_DOMAIN,
  MAIL_DEFAULT_SERVER_URL,
  MAIL_FLAG,
  type MailAttachment,
  type MailComposeInput,
  type MailFolder,
  type MailFolderRole,
  type MailListQuery,
  type MailMessage,
  type MailStatus,
  type MailSummary,
} from '../../shared/mail-local'
import { externalRecipients, replySubject, sortFolders, threadHeaders, toFolder, toMessage, toSummary } from './mail-model'

export interface MailConfig {
  serverUrl?: string
  domain?: string
  enabled?: boolean
}

export interface MailServiceDeps {
  configDir: string
  env?: NodeJS.ProcessEnv
  secrets: MailboxSecretStore
  /** Rox profile/login hints for the handle (first usable wins). */
  identity: () => Promise<{ ownerUuid?: string | null; handles: Array<string | null | undefined> }>
  adminCredentials?: () => Promise<{ username: string; secret: string }>
  emit?: (status?: MailStatus) => void
  log?: (message: string, error?: unknown) => void
  deviceLabel?: string
  fetch?: typeof fetch
  /** Display name for From (Rox profile); empty → address only. */
  senderName?: () => Promise<string | null>
}

const LOCAL_AGENT_LABEL = 'one.rox.mail.stalwart'
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined
  const s = v.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return undefined
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
  } catch {
    return false
  }
}

/** Read the local Stalwart admin credential from the macOS Keychain (never logged). */
export function keychainAdminCredentials(env: NodeJS.ProcessEnv = process.env): () => Promise<{ username: string; secret: string }> {
  const service = env.ROX_MAIL_ADMIN_KEYCHAIN_SERVICE || 'rox.mail.stalwart'
  const account = env.ROX_MAIL_ADMIN_KEYCHAIN_ACCOUNT || 'admin@rox.one'
  return () =>
    new Promise((resolve, reject) => {
      if (process.platform !== 'darwin') return reject(new Error('Keychain is available on macOS only'))
      execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { timeout: 10_000 }, (error, stdout) => {
        if (error) return reject(new Error(`Keychain item ${service}/${account} is not readable`))
        const secret = stdout.replace(/\n$/, '')
        if (!secret) return reject(new Error('Keychain item is empty'))
        resolve({ username: account, secret })
      })
    })
}

export class MailService {
  private readonly dir: string
  private readonly env: NodeJS.ProcessEnv
  private record: MailboxRecord | null = null
  private records: Record<string, MailboxRecord> = {}
  private activeOwnerUuid: string | null = null
  private client: JmapClient | null = null
  private stopPush: (() => void) | null = null
  private push: MailStatus['push'] = 'off'
  private provisioning: Promise<MailStatus> | null = null
  private lastError: string | undefined
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private archiveId: string | null = null

  constructor(private readonly deps: MailServiceDeps) {
    this.dir = join(deps.configDir, 'mail')
    this.env = deps.env ?? process.env
    this.records = this.readJson<Record<string, MailboxRecord>>('mailboxes.json') ?? {}
    const legacy = this.readJson<MailboxRecord>('mailbox.json')
    if (legacy && !this.records[legacy.ownerUuid]) this.records[legacy.ownerUuid] = legacy
    this.record = legacy
  }

  private async senderName(): Promise<string> {
    try {
      const name = (await this.deps.senderName?.())?.trim() ?? ''
      return name.startsWith('rox:') ? '' : name.slice(0, 120)
    } catch {
      return ''
    }
  }

  // ------------------------------------------------------------ config/state

  private readJson<T>(name: string): T | null {
    try {
      const p = join(this.dir, name)
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null
    } catch {
      return null
    }
  }

  private writeJson(name: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const p = join(this.dir, name)
    const tmp = `${p}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(tmp, p)
  }

  config(): Required<MailConfig> {
    const file = this.readJson<MailConfig>('config.json') ?? {}
    const envUrl = this.env.ROX_MAIL_SERVER_URL?.trim()
    const flag = parseBool(this.env.CRAFT_FEATURE_INBOX_MAIL)
    return {
      serverUrl: envUrl || file.serverUrl || MAIL_DEFAULT_SERVER_URL,
      domain: (this.env.ROX_MAIL_DOMAIN?.trim() || file.domain || MAIL_DEFAULT_DOMAIN).toLowerCase(),
      enabled: flag ?? file.enabled ?? true,
    }
  }

  setServerUrl(url: string): void {
    const normalized = normalizeBaseUrl(url)
    const file = this.readJson<MailConfig>('config.json') ?? {}
    this.writeJson('config.json', { ...file, serverUrl: normalized })
    this.resetClient()
  }

  private resetClient(): void {
    this.stopPush?.()
    this.stopPush = null
    this.push = 'off'
    this.client = null
    this.archiveId = null
  }

  private ownerUuidFallback(): string {
    const state = this.readJson<{ ownerUuid?: string }>('owner.json')
    if (state?.ownerUuid) return state.ownerUuid
    const ownerUuid = randomUUID()
    this.writeJson('owner.json', { ownerUuid })
    return ownerUuid
  }
  private async activateMailbox(who?: { ownerUuid?: string | null; handles: Array<string | null | undefined> }): Promise<{ ownerUuid: string; handles: Array<string | null | undefined> }> {
    const identity = who ?? await this.deps.identity()
    const ownerUuid = identity.ownerUuid || this.ownerUuidFallback()
    if (this.activeOwnerUuid !== ownerUuid) {
      this.resetClient()
      this.activeOwnerUuid = ownerUuid
      this.record = this.records[ownerUuid] ?? null
      this.lastError = undefined
    }
    return { ownerUuid, handles: identity.handles }
  }

  private persistMailbox(record: MailboxRecord): void {
    this.records[record.ownerUuid] = record
    this.writeJson('mailboxes.json', this.records)
    this.writeJson('mailbox.json', record)
  }

  private async reachable(serverUrl: string): Promise<boolean> {
    try {
      const f = this.deps.fetch ?? fetch
      const res = await f(`${normalizeBaseUrl(serverUrl)}/healthz/live`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  private lastStartAttempt = 0

  /**
   * Local pilot: if the Stalwart LaunchAgent exists but is not loaded (macOS
   * can block legacy login agents in Login Items), load it for this session.
   * Only ever touches our own user agent label; at most once a minute.
   */
  private startLocalServer(): void {
    if (process.platform !== 'darwin' || this.env.ROX_MAIL_NO_AUTOSTART === '1') return
    const now = Date.now()
    if (now - this.lastStartAttempt < 60_000) return
    this.lastStartAttempt = now
    const home = this.env.HOME
    if (!home) return
    const plist = join(home, 'Library', 'LaunchAgents', `${LOCAL_AGENT_LABEL}.plist`)
    if (!existsSync(plist)) return
    const uid = typeof process.getuid === 'function' ? process.getuid() : null
    if (uid === null) return
    const domain = `gui/${uid}`
    execFile('/bin/launchctl', ['print', `${domain}/${LOCAL_AGENT_LABEL}`], { timeout: 10_000 }, (notLoaded) => {
      const args = notLoaded ? ['bootstrap', domain, plist] : ['kickstart', `${domain}/${LOCAL_AGENT_LABEL}`]
      execFile('/bin/launchctl', args, { timeout: 15_000 }, (error) => {
        this.deps.log?.(`[mail] local Stalwart ${notLoaded ? 'bootstrap' : 'kickstart'}${error ? ' failed' : ' requested'}`, error ?? undefined)
      })
    })
  }

  async status(): Promise<MailStatus> {
    await this.activateMailbox()
    const cfg = this.config()
    const base: MailStatus = {
      flag: MAIL_FLAG,
      enabled: cfg.enabled,
      state: 'disabled',
      serverUrl: cfg.serverUrl,
      domain: cfg.domain,
      local: isLoopbackUrl(cfg.serverUrl),
      reachable: false,
      address: this.record?.address ?? null,
      push: this.push,
      error: this.lastError,
    }
    if (!cfg.enabled) return base
    base.reachable = await this.reachable(cfg.serverUrl)
    if (!base.reachable) {
      if (base.local) this.startLocalServer()
      return { ...base, state: 'unreachable' }
    }
    if (this.provisioning) return { ...base, state: 'provisioning' }
    if (!this.record || this.record.state !== 'READY') return { ...base, state: this.lastError ? 'error' : 'no-mailbox' }
    let secret: string | null
    try {
      secret = await this.deps.secrets.get(this.record.address)
    } catch {
      const error = 'Secure mailbox credentials are unavailable'
      this.lastError = error
      return { ...base, state: 'error', error }
    }
    if (!secret) {
      const error = 'Mailbox credential is missing from secure storage'
      this.lastError = error
      return { ...base, state: 'error', error }
    }
    try {
      const fetchImpl = this.deps.fetch ? (i: string, init?: RequestInit) => this.deps.fetch!(i, init) : undefined
      await new JmapClient({ baseUrl: cfg.serverUrl, username: this.record.address, secret }, { fetch: fetchImpl }).accountId()
      this.lastError = undefined
      return { ...base, state: 'ready', error: undefined }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mail server rejected the mailbox connection'
      this.lastError = message
      return { ...base, state: 'error', error: message }
    }
  }

  /** Idempotent: create/adopt `<handle>@domain`, mint + store the device credential, verify. */
  ensureMailbox(): Promise<MailStatus> {
    if (this.provisioning) return this.provisioning
    this.provisioning = (async () => {
      const cfg = this.config()
      try {
        if (!cfg.enabled) throw new Error(`${MAIL_FLAG} is disabled`)
        const serverUrl = normalizeBaseUrl(cfg.serverUrl)
        if (!isLoopbackUrl(serverUrl)) {
          throw new Error('Mailbox creation from the app is available only for the local mail server; production mailboxes are created by rox.one at sign-up')
        }
        const who = await this.activateMailbox(await this.deps.identity())
        const ownerUuid = who.ownerUuid
        const handleOverride = this.env.ROX_MAIL_HANDLE?.trim()
        const record = await provisionMailbox({
          baseUrl: serverUrl,
          domain: cfg.domain,
          ownerUuid,
          handleCandidates: handleOverride ? [handleOverride] : who.handles,
          fallbackHandle: 'mark',
          deviceLabel: this.deps.deviceLabel ?? `rox-desktop:${process.platform}`,
          admin: this.deps.adminCredentials ?? keychainAdminCredentials(this.env),
          secrets: this.deps.secrets,
          existing: this.record,
          fetch: this.deps.fetch,
          log: (m) => this.deps.log?.(m),
        })
        this.record = record
        this.persistMailbox(record)
        this.lastError = undefined
        this.resetClient()
        this.deps.log?.(`[mail] mailbox ready: ${record.address}`)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.deps.log?.('[mail] provisioning failed', this.lastError)
      } finally {
        this.provisioning = null
      }
      const s = await this.status()
      this.deps.emit?.(s)
      return s
    })()
    return this.provisioning
  }

  // ----------------------------------------------------------------- client

  private async jmap(): Promise<JmapClient> {
    await this.activateMailbox()
    if (this.client) return this.client
    const cfg = this.config()
    if (!cfg.enabled) throw new MailError('disabled', `${MAIL_FLAG} is disabled`)
    if (!this.record || this.record.state !== 'READY') throw new MailError('no-mailbox', 'No mailbox yet')
    const secret = await this.deps.secrets.get(this.record.address)
    if (!secret) throw new MailError('no-mailbox', 'Mailbox credential is missing')
    const fetchImpl = this.deps.fetch ? (i: string, init?: RequestInit) => this.deps.fetch!(i, init) : undefined
    this.client = new JmapClient({ baseUrl: cfg.serverUrl, username: this.record.address, secret }, { fetch: fetchImpl })
    this.startPush(this.client)
    return this.client
  }

  private startPush(client: JmapClient): void {
    this.stopPush?.()
    this.stopPush = client.subscribe(
      () => this.emitSoon(),
      { onStatus: (s) => { this.push = s === 'open' ? 'open' : 'retry' } },
    )
  }

  private emitSoon(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.deps.emit?.()
    }, 250)
  }

  dispose(): void {
    this.resetClient()
    if (this.emitTimer) clearTimeout(this.emitTimer)
  }

  async folders(): Promise<MailFolder[]> {
    const c = await this.jmap()
    return sortFolders((await c.mailboxes()).map(toFolder))
  }

  private async folderIdFor(target: MailFolderRole | string): Promise<string> {
    const c = await this.jmap()
    const boxes = await c.mailboxes()
    const byRole = boxes.find((b) => b.role === target)
    if (byRole) return byRole.id
    const byId = boxes.find((b) => b.id === target)
    if (byId) return byId.id
    if (target === 'archive') {
      if (this.archiveId) return this.archiveId
      const accountId = await c.accountId()
      const [[, res]] = await c.call([['Mailbox/set', { accountId, create: { a: { name: 'Архив', role: 'archive' } } }, 'a']])
      const id = res.created?.a?.id as string | undefined
      if (!id) throw new MailError('server', 'Could not create the Archive folder')
      this.archiveId = id
      return id
    }
    throw new MailError('not-found', `Folder ${target} not found`)
  }

  async list(query: MailListQuery): Promise<{ total: number; items: MailSummary[] }> {
    const c = await this.jmap()
    let mailboxId = query.folderId
    if (!mailboxId && query.role) mailboxId = await this.folderIdFor(query.role)
    const res = await c.queryEmails({ mailboxId, text: query.text, limit: Math.min(query.limit ?? 100, 200), unseenOnly: query.unseenOnly })
    let items = res.emails.map(toSummary)
    if (query.unseenOnly) items = items.filter((i) => !i.seen)
    return { total: res.total, items }
  }

  async get(id: string): Promise<MailMessage | null> {
    const c = await this.jmap()
    const e = await c.getEmail(id)
    return e ? toMessage(e) : null
  }
  async getThread(threadId: string): Promise<MailMessage[]> {
    const c = await this.jmap()
    return (await c.getThread(threadId)).map(toMessage)
  }

  async setFlags(ids: string[], flags: { seen?: boolean; flagged?: boolean }): Promise<number> {
    const c = await this.jmap()
    const patch: Record<string, unknown> = {}
    if (flags.seen !== undefined) patch['keywords/$seen'] = flags.seen ? true : null
    if (flags.flagged !== undefined) patch['keywords/$flagged'] = flags.flagged ? true : null
    const res = await c.updateEmails(Object.fromEntries(ids.map((id) => [id, patch])))
    return res.updated.length
  }

  async move(ids: string[], target: MailFolderRole | string): Promise<number> {
    const c = await this.jmap()
    const to = await this.folderIdFor(target)
    return (await c.moveEmails(ids, to)).updated.length
  }

  /** Delete → Корзина; already in Корзина (or drafts) → destroy. */
  async remove(ids: string[]): Promise<number> {
    const c = await this.jmap()
    const boxes = await c.mailboxes()
    const trash = boxes.find((b) => b.role === 'trash')
    const drafts = boxes.find((b) => b.role === 'drafts')
    const accountId = await c.accountId()
    const [[, got]] = await c.call([['Email/get', { accountId, ids, properties: ['mailboxIds'] }, 'g']])
    const destroy: string[] = []
    const moveIds: string[] = []
    for (const e of got.list ?? []) {
      const inBoxes = Object.keys(e.mailboxIds ?? {})
      if (!trash || inBoxes.includes(trash.id) || (drafts && inBoxes.length === 1 && inBoxes[0] === drafts.id)) destroy.push(e.id)
      else moveIds.push(e.id)
    }
    let n = 0
    if (moveIds.length && trash) n += (await c.moveEmails(moveIds, trash.id)).updated.length
    if (destroy.length) n += (await c.destroyEmails(destroy)).length
    return n
  }

  private async prepare(input: MailComposeInput, sending = false) {
    const c = await this.jmap()
    const cfg = this.config()
    const record = this.record!
    const to = parseAddressList(input.to)
    const cc = parseAddressList(input.cc ?? '')
    const bcc = parseAddressList(input.bcc ?? '')
    const all = [...to, ...cc, ...bcc].map((a) => a.email)
    if (sending && !all.length) throw new MailError('invalid', 'No valid recipients')
    if (sending && isLoopbackUrl(cfg.serverUrl)) {
      const external = externalRecipients(all, cfg.domain)
      if (external.length) {
        throw new MailError('external-blocked', `Local mail server: only @${cfg.domain} recipients are delivered (${external.join(', ')})`)
      }
    }
    let headers: { inReplyTo?: string[]; references?: string[] } = {}
    let subject = input.subject
    if (input.sourceId && input.mode && input.mode !== 'new') {
      const src = await this.get(input.sourceId)
      if (src) {
        if (input.mode !== 'forward') headers = threadHeaders(src)
        if (!subject.trim()) subject = replySubject(src.subject, input.mode)
      }
    }
    const attachments: Array<{ blobId: string; type: string; name: string; size: number }> = []
    for (const a of input.forwardAttachments ?? []) attachments.push({ blobId: a.blobId, type: a.type, name: a.name, size: a.size })
    for (const f of input.files ?? []) {
      const st = await stat(f.path)
      if (!st.isFile()) throw new MailError('invalid', `${f.name} is not a file`)
      if (st.size > MAX_ATTACHMENT_BYTES) throw new MailError('too-large', `${f.name} is larger than 25 MB`)
      const up = await c.upload(new Uint8Array(await readFile(f.path)), f.type || 'application/octet-stream')
      attachments.push({ blobId: up.blobId, type: f.type || up.type || 'application/octet-stream', name: f.name, size: up.size })
    }
    return { c, cfg, record, to, cc, bcc, all, headers, subject, attachments }
  }

  async send(input: MailComposeInput): Promise<{ emailId: string }> {
    const p = await this.prepare(input, true)
    const identity = await p.c.ensureIdentity(p.record.address, await this.senderName())
    const result = await p.c.compose({
      from: { name: identity.name || null, email: p.record.address },
      to: p.to, cc: p.cc, bcc: p.bcc,
      subject: p.subject, text: input.text,
      inReplyTo: p.headers.inReplyTo, references: p.headers.references,
      attachments: p.attachments,
      identityId: identity.id,
      replaceDraftId: input.draftId,
      send: true,
    })
    if (input.mode === 'reply' || input.mode === 'replyAll') {
      if (input.sourceId) await p.c.updateEmails({ [input.sourceId]: { 'keywords/$answered': true } }).catch(() => undefined)
    }
    return { emailId: result.emailId }
  }

  async saveDraft(input: MailComposeInput): Promise<{ draftId: string }> {
    const p = await this.prepare(input)
    const res = await p.c.compose({
      from: { name: (await this.senderName()) || null, email: p.record.address },
      to: p.to, cc: p.cc, bcc: p.bcc,
      subject: p.subject, text: input.text,
      inReplyTo: p.headers.inReplyTo, references: p.headers.references,
      attachments: p.attachments,
      replaceDraftId: input.draftId,
      send: false,
    })
    return { draftId: res.emailId }
  }

  async download(attachment: MailAttachment): Promise<Uint8Array> {
    const c = await this.jmap()
    return c.download(attachment.blobId, attachment.name, attachment.type)
  }

  /** Mailbox record for diagnostics (no secrets). */
  mailbox(): MailboxRecord | null {
    return this.record
  }
}

export class MailError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MailError'
  }
}

export function errorResult(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof MailError) return { ok: false, code: error.code, message: error.message }
  if (error instanceof JmapError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'error', message: error instanceof Error ? error.message : String(error) }
}
