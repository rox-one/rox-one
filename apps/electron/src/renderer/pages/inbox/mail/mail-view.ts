/**
 * Pure helpers for the «Почта» section of Входящие: labels, reply/forward
 * drafts, «Все» rows and status copy keys. No I/O (unit-tested).
 */
import type { MailAddress, MailAttachment, MailMessage, MailStatus, MailSummary } from '../../../../shared/mail-local'
import type { InboxItem } from '../inbox-model'

export function addressLabel(a: MailAddress | undefined | null): string {
  if (!a) return ''
  return a.name?.trim() || a.email
}

export function addressLine(list: readonly MailAddress[]): string {
  return list.map((a) => (a.name?.trim() ? `${a.name.trim()} <${a.email}>` : a.email)).join(', ')
}

export function fromLabel(m: Pick<MailSummary, 'from'>): string {
  return addressLabel(m.from[0]) || '—'
}

export const MAIL_ITEM_PREFIX = 'mail:'

export function mailItemId(emailId: string): string {
  return `${MAIL_ITEM_PREFIX}${emailId}`
}

export function emailIdFromItem(itemId: string): string | null {
  return itemId.startsWith(MAIL_ITEM_PREFIX) ? itemId.slice(MAIL_ITEM_PREFIX.length) : null
}

/** Unread inbox mail surfaces in «Все» as message rows. */
export function mailToInboxItem(m: MailSummary, noSubject: string): InboxItem {
  return {
    id: mailItemId(m.id),
    kind: 'mail',
    group: 'message',
    blocking: false,
    title: m.subject.trim() || noSubject,
    source: fromLabel(m),
    at: m.receivedAt,
    data: m,
  }
}

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

export interface ComposeDraft {
  mode: ComposeMode
  sourceId?: string
  /** Continue an existing Drafts message (replaced on save/send). */
  draftId?: string
  to: string
  cc: string
  bcc: string
  subject: string
  text: string
  /** Server-stored JMAP blobs survive closing and reopening the composer. */
  attachments?: MailAttachment[]
}

function prefixed(subject: string, prefix: 'Re' | 'Fwd'): string {
  const s = subject.trim()
  const re = prefix === 'Re' ? /^(re|отв)\s*:/i : /^(fwd?|пересл)\s*:/i
  return re.test(s) ? s : `${prefix}: ${s}`
}

function quote(text: string): string {
  return text.split('\n').map((l) => `> ${l}`).join('\n')
}

export function plainText(m: Pick<MailMessage, 'text' | 'html' | 'preview'>): string {
  if (m.text.trim()) return m.text
  if (m.html) {
    return m.html
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return m.preview
}

export function buildDraft(mode: ComposeMode, source: MailMessage | null, me: string | null, header: (m: MailMessage) => string): ComposeDraft {
  if (mode === 'new' || !source) return { mode: 'new', to: '', cc: '', bcc: '', subject: '', text: '' }
  const mine = (me ?? '').toLowerCase()
  const notMe = (a: MailAddress) => a.email.toLowerCase() !== mine
  const body = `\n\n${header(source)}\n${quote(plainText(source))}`
  if (mode === 'forward') {
    return { mode, sourceId: source.id, to: '', cc: '', bcc: '', subject: prefixed(source.subject, 'Fwd'), text: `\n\n${header(source)}\n\n${plainText(source)}`, attachments: source.attachments }
  }
  const replyTarget = source.replyTo.length ? source.replyTo : source.from
  const to = replyTarget.filter(notMe)
  const toFinal = to.length ? to : source.to.filter(notMe)
  let cc: MailAddress[] = []
  if (mode === 'replyAll') {
    const seen = new Set(toFinal.map((a) => a.email.toLowerCase()))
    cc = [...source.to, ...source.cc].filter((a) => notMe(a) && !seen.has(a.email.toLowerCase()) && (seen.add(a.email.toLowerCase()), true))
  }
  return { mode, sourceId: source.id, to: addressLine(toFinal), cc: addressLine(cc), bcc: '', subject: prefixed(source.subject, 'Re'), text: body }
}

/** Reopen a saved draft in the composer. */
export function draftFromMessage(m: MailMessage): ComposeDraft {
  return { mode: 'new', draftId: m.id, to: addressLine(m.to), cc: addressLine(m.cc), bcc: addressLine(m.bcc), subject: m.subject, text: plainText(m), attachments: m.attachments }
}

export function draftHasContent(d: ComposeDraft): boolean {
  return !!(d.to.trim() || d.cc.trim() || d.bcc.trim() || d.subject.trim() || d.attachments?.length || d.text.replace(/^[\s>]*$/gm, '').trim())
}

/** i18n key for the one-line status (status bar / banner). */
export function statusKey(s: MailStatus | null): string {
  if (!s) return 'inbox.mail.status.loading'
  if (!s.enabled) return 'inbox.mail.status.disabled'
  switch (s.state) {
    case 'unreachable': return 'inbox.mail.status.unreachable'
    case 'provisioning': return 'inbox.mail.status.provisioning'
    case 'no-mailbox': return 'inbox.mail.status.noMailbox'
    case 'error': return 'inbox.mail.status.error'
    case 'ready': return s.local ? 'inbox.mail.status.readyLocal' : 'inbox.mail.status.ready'
    default: return 'inbox.mail.status.disabled'
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Text appended to a meeting's notes when an email is linked to it. */
export function meetingNoteLine(m: Pick<MailSummary, 'id' | 'subject' | 'from' | 'receivedAt'>, label: string, noSubject: string): string {
  const d = new Date(m.receivedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${label}: «${m.subject.trim() || noSubject}» — ${fromLabel(m)}, ${when} (mail:${m.id})`
}
