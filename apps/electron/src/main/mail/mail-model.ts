/**
 * Pure mapping between JMAP objects and the renderer-facing mail contract,
 * plus local-mode guards. No I/O (unit-tested).
 */
import type { JmapAddress, JmapEmailFull, JmapEmailSummary, JmapMailbox } from '@craft-agent/shared/mail'
import type { MailAddress, MailAttachment, MailFolder, MailFolderRole, MailMessage, MailSummary } from '../../shared/mail-local'

const ROLES: ReadonlySet<string> = new Set(['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'])
const ROLE_ORDER: MailFolderRole[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']

export function toFolder(m: JmapMailbox): MailFolder {
  const role = m.role && ROLES.has(m.role) ? (m.role as MailFolderRole) : null
  return { id: m.id, name: m.name, role, total: m.totalEmails ?? 0, unread: m.unreadEmails ?? 0 }
}

export function sortFolders(folders: MailFolder[]): MailFolder[] {
  const rank = (f: MailFolder) => (f.role ? ROLE_ORDER.indexOf(f.role) : ROLE_ORDER.length)
  return [...folders].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function addrs(list: JmapAddress[] | null | undefined): MailAddress[] {
  return (list ?? []).map((a) => ({ name: a.name ?? null, email: a.email }))
}

export function toSummary(e: JmapEmailSummary): MailSummary {
  const kw = e.keywords ?? {}
  return {
    id: e.id,
    threadId: e.threadId,
    folderIds: Object.keys(e.mailboxIds ?? {}).filter((k) => e.mailboxIds[k]),
    from: addrs(e.from),
    to: addrs(e.to),
    subject: e.subject ?? '',
    preview: e.preview ?? '',
    receivedAt: Date.parse(e.receivedAt) || 0,
    seen: !!kw.$seen,
    flagged: !!kw.$flagged,
    draft: !!kw.$draft,
    hasAttachment: !!e.hasAttachment,
    size: e.size ?? 0,
  }
}

export function toMessage(e: JmapEmailFull): MailMessage {
  const value = (parts: JmapEmailFull['textBody']) =>
    (parts ?? [])
      .map((p) => (p.partId ? e.bodyValues?.[p.partId]?.value ?? '' : ''))
      .filter(Boolean)
      .join('\n')
  const htmlParts = (e.htmlBody ?? []).filter((p) => p.type === 'text/html')
  const html = htmlParts.length ? value(htmlParts) : null
  const attachments: MailAttachment[] = (e.attachments ?? [])
    .filter((p) => p.blobId)
    .map((p) => ({
      blobId: p.blobId!,
      name: p.name || 'attachment',
      type: p.type || 'application/octet-stream',
      size: p.size ?? 0,
      inline: p.disposition === 'inline' && !!p.cid,
    }))
  return {
    ...toSummary(e),
    cc: addrs(e.cc),
    bcc: addrs(e.bcc),
    replyTo: addrs(e.replyTo),
    sentAt: e.sentAt ? Date.parse(e.sentAt) || null : null,
    messageId: e.messageId ?? [],
    inReplyTo: e.inReplyTo ?? [],
    references: e.references ?? [],
    text: value(e.textBody),
    html,
    attachments,
  }
}

export function domainOf(email: string): string {
  return email.split('@').pop()?.toLowerCase() ?? ''
}

/** Local pilot: the server cannot deliver outside its own domain. */
export function externalRecipients(emails: string[], localDomain: string): string[] {
  return emails.filter((e) => domainOf(e) !== localDomain.toLowerCase())
}

export function replySubject(subject: string, mode: 'reply' | 'replyAll' | 'forward'): string {
  const s = subject.trim()
  if (mode === 'forward') return /^(fwd?|пересл)\s*:/i.test(s) ? s : `Fwd: ${s}`
  return /^(re|отв)\s*:/i.test(s) ? s : `Re: ${s}`
}

export function threadHeaders(source: { messageId: string[]; references: string[] }): { inReplyTo: string[]; references: string[] } {
  const references = [...source.references, ...source.messageId].filter((v, i, a) => v && a.indexOf(v) === i)
  return { inReplyTo: source.messageId, references }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim()
  return (cleaned || 'attachment').slice(0, 180)
}
