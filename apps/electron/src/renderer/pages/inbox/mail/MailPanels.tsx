/**
 * «Почта» inside Входящие (inbox.mail.v1): navigator block (address + folders),
 * list panel (search, rows) and detail (reader / compose). Flat, borderless,
 * compact — same mode-screen kit as the rest of Входящие.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  EmptyState,
  ListHeader,
  ListRow,
  NavItem,
  NavSection,
  SectionLabel,
  useListKeys,
} from '@/components/mode-screen/ModeScreen'
import { navigate, routes } from '@/lib/navigate'
import { useConfirmedTaskConversion } from '@/hooks/useConfirmedTaskConversion'
import { useAtomValue } from 'jotai'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import type { LocalMeeting } from '../../../../shared/meetings-local'
import type { MailAttachment, MailFolder, MailFolderRole, MailMessage, MailPickedFile, MailSummary } from '../../../../shared/mail-local'
import { mailSrcdoc, sanitizeMailHtml } from './mail-sanitize'
import { addressLabel, addressLine, buildDraft, draftFromMessage, draftHasContent, formatBytes, fromLabel, meetingNoteLine, statusKey, type ComposeDraft, type ComposeMode } from './mail-view'
import type { MailController } from './useMail'
import { toErrorMessage } from '@/lib/errors'

const FOLDER_KEYS: Record<MailFolderRole, string> = {
  inbox: 'inbox.mail.folder.inbox',
  drafts: 'inbox.mail.folder.drafts',
  sent: 'inbox.mail.folder.sent',
  archive: 'inbox.mail.folder.archive',
  junk: 'inbox.mail.folder.junk',
  trash: 'inbox.mail.folder.trash',
}

function useFormatters() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage || i18n.language
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    const full = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    return {
      short: (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? time.format(at) : date.format(at)),
      full: (at: number) => full.format(at),
    }
  }, [locale])
}

export function folderLabel(t: (k: string) => string, f: Pick<MailFolder, 'role' | 'name'>): string {
  return f.role ? t(FOLDER_KEYS[f.role]) : f.name
}

// ------------------------------------------------------------------ navigator

export function MailNavSection({ mail, activeFolderId, onSelectFolder }: {
  mail: MailController
  activeFolderId: string | null
  onSelectFolder: (folder: MailFolder) => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const s = mail.status
  const address = s?.address
  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard denied */ }
  }
  return (
    <NavSection title={t('inbox.mail.section')}>
      {s?.state === 'ready' && address ? (
        <div className="flex items-center gap-1 px-2 pb-1" data-testid="mail-address">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" title={address}>{address}</span>
          <button type="button" onClick={() => void copy()} className="h-6 shrink-0 rounded-[var(--radius-control)] px-1.5 text-[11px] text-text-secondary hover:bg-foreground/[0.06] hover:text-foreground" data-testid="mail-copy">
            {copied ? t('inbox.mail.copied') : t('inbox.mail.copy')}
          </button>
        </div>
      ) : (
        <div className="px-2 pb-1 text-[11px] text-text-muted">{t(statusKey(s), { address: s?.address ?? '', url: s?.serverUrl ?? '', error: s?.error ?? '', flag: s?.flag ?? '' })}</div>
      )}
      {s?.state === 'ready'
        ? mail.folders.map((f) => (
            <NavItem
              key={f.id}
              label={folderLabel(t, f)}
              count={f.role === 'drafts' || f.role === 'sent' ? f.total : f.unread}
              active={activeFolderId === f.id}
              onClick={() => onSelectFolder(f)}
              testId={`mail-folder-${f.role ?? f.id}`}
            />
          ))
        : (
            <NavItem label={t('inbox.kind.mail')} dot="muted" active={activeFolderId === 'inbox'} onClick={() => onSelectFolder({ id: 'inbox', name: 'Inbox', role: 'inbox', total: 0, unread: 0 })} testId="mail-folder-inbox" />
          )}
    </NavSection>
  )
}

// ---------------------------------------------------------------------- list

export function MailListPanel({ mail, title, selectedId, onSelect, onCompose, onOpen }: {
  mail: MailController
  title: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCompose: () => void
  onOpen?: (id: string) => void
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const [query, setQuery] = useState(mail.search)
  const selected = mail.items.find((i) => i.id === selectedId) ?? null
  const onKeys = useListKeys(mail.items, selected, (i) => onSelect(i.id), (i) => onOpen?.(i.id))
  const s = mail.status

  if (!s || s.state !== 'ready') {
    return (
      <>
        <ListHeader title={title} />
        <MailStatusBlock mail={mail} />
      </>
    )
  }

  return (
    <>
      <ListHeader
        title={title}
        subtitle={mail.total ? String(mail.total) : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => void mail.refresh()}>{t('inbox.refresh')}</Button>
            <Button variant="primary" onClick={onCompose} data-testid="mail-compose">{t('inbox.mail.compose')}</Button>
          </>
        }
      />
      <form className="px-3 pb-1.5" onSubmit={(e) => { e.preventDefault(); mail.setSearch(query.trim()) }}>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value) mail.setSearch('') }}
          placeholder={t('inbox.mail.search')}
          aria-label={t('inbox.mail.search')}
          data-testid="mail-search"
          className="h-7 w-full rounded-[var(--radius-card)] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
        />
      </form>
      {s.local ? <LocalNotice domain={s.domain} compact /> : null}
      {mail.error ? <div role="alert" className="mx-3 mt-1 rounded-[var(--radius-card)] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{mail.error}</div> : null}
      <div role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onKeys} data-testid="mail-list">
        {mail.items.length === 0 ? (
          <EmptyState
            testId="mail-empty"
            title={mail.search ? t('inbox.mail.empty.searchTitle') : t('inbox.mail.empty.title')}
            body={mail.search ? undefined : t('inbox.mail.empty.body', { address: s.address ?? '' })}
          />
        ) : (
          mail.items.map((m) => (
            <ListRow key={m.id} testId="mail-row" selected={m.id === selectedId} unread={!m.seen} onClick={() => onSelect(m.id)}>
              <span aria-hidden className="w-4 shrink-0 pt-px text-center text-text-muted">{m.flagged ? '★' : m.draft ? '✎' : '✉'}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12px] ${m.seen ? 'text-text-muted' : 'font-semibold text-foreground'}`}>{m.draft ? addressLine(m.to) || t('inbox.mail.folder.drafts') : fromLabel(m)}</span>
                <span className={`block truncate ${m.seen ? '' : 'font-semibold'}`}>{m.subject.trim() || t('inbox.mail.noSubject')}</span>
                <span className="block truncate text-[12px] text-text-muted">{m.preview}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-[11px] tabular-nums text-text-muted">{fmt.short(m.receivedAt)}</span>
                {m.hasAttachment ? <span aria-label={t('inbox.mail.attachments')} className="text-[11px] text-text-muted">⎘</span> : null}
              </span>
            </ListRow>
          ))
        )}
      </div>
    </>
  )
}

export function LocalNotice({ domain, compact }: { domain: string; compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="mx-3 mb-1 rounded-[var(--radius-card)] bg-foreground/[0.05] px-2.5 py-1.5 text-[12px] text-text-secondary" role="note" data-testid="mail-local-notice">
      <span className="font-semibold text-foreground">{t('inbox.mail.localNotice')}</span>
      {compact ? null : <span className="block pt-0.5">{t('inbox.mail.localNoticeBody', { domain })}</span>}
    </div>
  )
}

export function MailStatusBlock({ mail }: { mail: MailController }) {
  const { t } = useTranslation()
  const s = mail.status
  const [url, setUrl] = useState(s?.serverUrl ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (s?.serverUrl) setUrl(s.serverUrl) }, [s?.serverUrl])
  if (!mail.available) return <EmptyState title={t('inbox.mail.status.disabled', { flag: 'inbox.mail.v1' })} />
  if (!s) return <EmptyState title={t('inbox.mail.status.loading')} />
  const saveServer = async () => {
    setSaving(true)
    try {
      const r = await window.electronAPI.mailLocal!.setServer(url)
      if (!r.ok) mail.setError(r.message)
      else await mail.refreshStatus()
    } finally {
      setSaving(false)
    }
  }
  const serverForm = (
    <form className="flex w-full max-w-[360px] items-center gap-1.5 pt-2" onSubmit={(e) => { e.preventDefault(); void saveServer() }}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t('inbox.mail.server')} placeholder={t('inbox.mail.server')}
        className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] bg-foreground/[0.05] px-2 font-mono text-[12px] outline-none focus:bg-foreground/[0.08]" data-testid="mail-server-url" />
      <Button type="submit" disabled={saving}>{t('inbox.mail.serverSave')}</Button>
    </form>
  )
  return (
    <div className="flex flex-col" data-testid="mail-status" data-state={s.state}>
      {s.state === 'no-mailbox' || s.state === 'error' ? (
        <EmptyState
          title={s.state === 'error' ? t('inbox.mail.status.error', { error: s.error ?? '' }) : t('inbox.mail.status.noMailbox')}
          body={t('inbox.mail.noMailboxBody', { domain: s.domain })}
          action={<Button variant="primary" onClick={() => void mail.ensure()} data-testid="mail-get-address">{t('inbox.mail.getAddress')}</Button>}
        />
      ) : s.state === 'provisioning' ? (
        <EmptyState title={t('inbox.mail.status.provisioning')} />
      ) : s.state === 'unreachable' ? (
        <EmptyState title={s.configured === false && !s.address ? t('inbox.mail.status.noMailbox') : t('inbox.mail.status.unreachable', { url: s.serverUrl })} body={t('inbox.mail.unreachableBody', { url: s.serverUrl })} action={serverForm} />
      ) : (
        <EmptyState title={t('inbox.mail.status.disabled', { flag: s.flag })} />
      )}
      {mail.error ? <p role="alert" className="px-4 text-[12px] text-destructive">{mail.error}</p> : null}
      {s.local && s.state !== 'disabled' ? <LocalNotice domain={s.domain} /> : null}
    </div>
  )
}

// -------------------------------------------------------------------- reader

function AddressRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="w-12 shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-secondary">{value}</span>
    </div>
  )
}

function HtmlBody({ html }: { html: string }) {
  const { t } = useTranslation()
  const [allowImages, setAllowImages] = useState(false)
  const clean = useMemo(() => sanitizeMailHtml(html, { allowImages }), [html, allowImages])
  return (
    <div className="flex min-h-[320px] flex-1 flex-col">
      {clean.blockedImages > 0 && !allowImages ? (
        <div className="flex items-center gap-2 pb-2 text-[12px] text-text-muted" data-testid="mail-images-blocked">
          <span>{t('inbox.mail.images.blocked', { count: clean.blockedImages })}</span>
          <Button variant="ghost" onClick={() => setAllowImages(true)}>{t('inbox.mail.images.show')}</Button>
        </div>
      ) : null}
      <iframe
        title={t('inbox.mail.bodyTitle')}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={mailSrcdoc(clean.html, { allowImages })}
        className="min-h-[320px] w-full flex-1 rounded-[var(--radius-card)] bg-white"
        data-testid="mail-html"
      />
    </div>
  )
}

function MeetingPicker({ message, onDone }: { message: MailSummary; onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const [meetings, setMeetings] = useState<LocalMeeting[] | null>(null)
  const localApi = window.electronAPI?.meetingsLocal
  useEffect(() => {
    void localApi?.list(null).then((list) => setMeetings([...list].sort((a, b) => (b.scheduledAt ?? b.createdAt) - (a.scheduledAt ?? a.createdAt)).slice(0, 8))).catch(() => setMeetings([]))
  }, [localApi])
  const note = meetingNoteLine(message, t('inbox.mail.meetingNote'), t('inbox.mail.noSubject'))
  const link = async (m: LocalMeeting) => {
    await localApi?.update(m.id, { notes: m.notes ? `${m.notes}\n\n${note}` : note })
    onDone(t('inbox.mail.meetingLinked', { title: m.title }))
  }
  const create = async () => {
    if (!localApi) return
    const m = await localApi.create({ title: message.subject.trim() || t('inbox.mail.noSubject'), workspaceId: null })
    await localApi.update(m.id, { notes: note })
    onDone(t('inbox.mail.meetingLinked', { title: m.title }))
  }
  if (!localApi) return null
  return (
    <div className="mt-2 flex flex-col gap-0.5 rounded-[var(--radius-card)] bg-foreground/[0.04] p-2" data-testid="mail-meeting-picker">
      {meetings === null ? <span className="text-[12px] text-text-muted">…</span> : null}
      {meetings?.length === 0 ? <span className="px-1 text-[12px] text-text-muted">{t('inbox.mail.noMeetings')}</span> : null}
      {meetings?.map((m) => (
        <button key={m.id} type="button" onClick={() => void link(m)} className="flex h-7 items-center rounded-[var(--radius-control)] px-2 text-left text-[12px] hover:bg-foreground/[0.06]">
          <span className="min-w-0 flex-1 truncate">{m.title}</span>
        </button>
      ))}
      <Button variant="ghost" onClick={() => void create()}>{t('inbox.mail.newMeeting')}</Button>
    </div>
  )
}

export function MailReader({ mail, message, onCompose, onEditDraft, onAfterRemove, compact }: {
  mail: MailController
  message: MailMessage
  onCompose: (mode: ComposeMode) => void
  onEditDraft?: (m: MailMessage) => void
  onAfterRemove?: () => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const fmt = useFormatters()
  const [notice, setNotice] = useState<{ text: string; path?: string; task?: boolean } | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [threadMessages, setThreadMessages] = useState<MailMessage[]>([message])
  useEffect(() => {
    let active = true
    setThreadMessages([message])
    void mail.getThread(message.threadId).then((messages) => {
      if (active) setThreadMessages(messages.length ? messages : [message])
    }).catch((e) => {
      if (active) setNotice({ text: toErrorMessage(e) })
    })
    return () => { active = false }
  }, [message, mail.getThread])
  useEffect(() => { setNotice(null); setPicking(false) }, [message.id])
  const inTrash = message.folderIds.some((id) => mail.folders.find((f) => f.id === id)?.role === 'trash')
  const inArchive = message.folderIds.some((id) => { const role = mail.folders.find((f) => f.id === id)?.role; return role === 'archive' || role === 'junk' })

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      setNotice({ text: toErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const save = (emailId: string, a: MailAttachment) => run(async () => {
    const r = await mail.act((api) => api.saveAttachment(emailId, a))
    setNotice({ text: t('inbox.mail.saved'), path: r.path })
  })
  const taskConversion = useConfirmedTaskConversion({ sourceKey: JSON.stringify([workspaceId, mail.status?.address, message.id]), source: message, workspaceId,
    input: {
      title: message.subject.trim() || t('inbox.mail.noSubject'),
      notes: `${t('inbox.mail.from')}: ${addressLine(message.from)}\n${fmt.full(message.receivedAt)}\nmail-thread:${message.threadId}\n\n${message.preview}`,
    },
  })

  return (
    <div className="flex min-h-full flex-col px-5 py-4" data-testid="mail-reader" data-id={message.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        {message.draft && onEditDraft ? <Button variant="primary" onClick={() => onEditDraft(message)} data-testid="mail-edit-draft">{t('inbox.mail.editDraft')}</Button> : null}
        <Button variant={message.draft ? 'secondary' : 'primary'} onClick={() => onCompose('reply')} data-testid="mail-reply">{t('inbox.mail.reply')}</Button>
        <Button onClick={() => onCompose('replyAll')}>{t('inbox.mail.replyAll')}</Button>
        <Button onClick={() => onCompose('forward')} data-testid="mail-forward">{t('inbox.mail.forward')}</Button>
        <span className="w-2" />
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => mail.act((a) => a.setFlags([message.id], { seen: !message.seen })))} data-testid="mail-toggle-read">
          {message.seen ? t('inbox.mail.markUnread') : t('inbox.mail.markRead')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => mail.act((a) => a.setFlags([message.id], { flagged: !message.flagged })))} data-testid="mail-star" aria-pressed={message.flagged}>
          {message.flagged ? `★ ${t('inbox.mail.unstar')}` : `☆ ${t('inbox.mail.star')}`}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => mail.act((a) => a.move([message.id], inArchive || inTrash ? 'inbox' : 'archive')), onAfterRemove)} data-testid="mail-archive" title="E">
          {inArchive || inTrash ? t('inbox.mail.toInbox') : t('inbox.mail.archive')}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void run(() => mail.act((a) => a.remove([message.id])), onAfterRemove)} data-testid="mail-delete" title="#">
          {t('inbox.mail.delete')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
        <Button variant="ghost" disabled={taskConversion.busy || !!taskConversion.taskId} onClick={() => { void taskConversion.convert() }} data-testid="mail-to-task">{t('inbox.mail.toTask')}</Button>
        <Button variant="ghost" onClick={() => setPicking((v) => !v)} data-testid="mail-to-meeting" aria-expanded={picking}>{t('inbox.mail.toMeeting')}</Button>
      </div>
      {picking ? <MeetingPicker message={message} onDone={(text) => { setPicking(false); setNotice({ text }) }} /> : null}
      {taskConversion.failed ? <div role="alert" data-testid="mail-task-error">{t('tasks.toastCreateFailed')}</div> : null}
      {taskConversion.taskId ? <div role="status" data-testid="mail-task-created"><span>{t('inbox.mail.taskCreated')}</span><Button variant="ghost" onClick={() => navigate(routes.view.tasks(taskConversion.taskId!))}>{t('inbox.mail.openTask')}</Button></div> : null}
      {notice ? (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.05] px-2.5 py-1.5 text-[12px]" data-testid="mail-notice">
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          {notice.path ? <Button variant="ghost" onClick={() => void window.electronAPI.mailLocal?.reveal(notice.path!)}>{t('inbox.mail.reveal')}</Button> : null}
          {notice.task ? <Button variant="ghost" onClick={() => navigate(routes.view.tasks())}>{t('inbox.mail.openTask')}</Button> : null}
        </div>
      ) : null}

      <h2 className={`pt-3 font-semibold ${compact ? 'text-[15px]' : 'text-[17px]'}`} data-testid="mail-subject">{message.subject.trim() || t('inbox.mail.noSubject')}</h2>
      <div className="flex flex-col gap-0.5 pt-1.5">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold">{addressLabel(message.from[0])}</span>
          {message.from[0]?.name ? <span className="text-text-muted">{message.from[0].email}</span> : null}
          <span className="ml-auto tabular-nums text-text-muted">{fmt.full(message.receivedAt)}</span>
        </div>
        <AddressRow label={t('inbox.mail.to')} value={addressLine(message.to)} />
        <AddressRow label={t('inbox.mail.cc')} value={addressLine(message.cc)} />
      </div>
      {threadMessages.filter((entry) => entry.id !== message.id).map((entry) => (
        <article key={entry.id} className="mt-3 rounded-[var(--radius-card)] bg-foreground/[0.03] p-3" data-testid="mail-thread-message">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-semibold">{addressLine(entry.from) || '—'}</span>
            <span className="ml-auto tabular-nums text-text-muted">{fmt.full(entry.receivedAt)}</span>
          </div>
          <AddressRow label={t('inbox.mail.to')} value={addressLine(entry.to)} />
          <AddressRow label={t('inbox.mail.cc')} value={addressLine(entry.cc)} />
          {entry.attachments.length ? (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {entry.attachments.map((a) => (
                <button key={a.blobId} type="button" onClick={() => void save(entry.id, a)} title={t('inbox.mail.save')} className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-[var(--radius-control)] bg-foreground/[0.06] px-2 text-[12px] hover:bg-foreground/[0.1]">
                  <span className="min-w-0 truncate">{a.name}</span><span className="shrink-0 text-text-muted">{formatBytes(a.size)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {entry.html ? <HtmlBody html={entry.html} /> : <div className="whitespace-pre-wrap break-words pt-2 text-[13px] leading-[1.5]">{entry.text || entry.preview}</div>}
        </article>
      ))}

      {message.attachments.length ? (
        <>
          <SectionLabel>{t('inbox.mail.attachments')}</SectionLabel>
          <div className="flex flex-wrap gap-1.5" data-testid="mail-attachments">
            {message.attachments.map((a) => (
              <button key={a.blobId} type="button" onClick={() => void save(message.id, a)} title={t('inbox.mail.save')}
                className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-[var(--radius-control)] bg-foreground/[0.06] px-2 text-[12px] hover:bg-foreground/[0.1]" data-testid="mail-attachment">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="shrink-0 text-text-muted">{formatBytes(a.size)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="flex flex-1 flex-col pt-4">
        {message.html ? (
          <HtmlBody html={message.html} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.5]" data-testid="mail-text">{message.text || message.preview}</div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- compose

export function MailCompose({ mail, draft, source, onClose }: {
  mail: MailController
  draft: ComposeDraft
  source: MailMessage | null
  onClose: (sent: boolean) => void
}) {
  const { t } = useTranslation()
  const [d, setD] = useState<ComposeDraft>(draft)
  const [files, setFiles] = useState<MailPickedFile[]>([])
  const [forwardAtt, setForwardAtt] = useState<MailAttachment[]>(draft.attachments ?? (draft.mode === 'forward' && source ? source.attachments : []))
  const [showCc, setShowCc] = useState(!!draft.cc)
  const [showBcc, setShowBcc] = useState(!!draft.bcc)
  const [busy, setBusy] = useState<'send' | 'draft' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const draftId = useRef<string | undefined>(draft.draftId)
  const dirty = useRef(false)
  const sending = useRef(false)
  const saving = useRef<Promise<void> | null>(null)
  const domain = mail.status?.domain ?? 'rox.one'

  const input = useCallback(() => ({
    to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: d.text,
    sourceId: d.sourceId, mode: d.mode, files, forwardAttachments: forwardAtt, draftId: draftId.current,
  }), [d, files, forwardAtt])

  const saveDraft = useCallback(async (quiet = false) => {
    // Never race a send: it replaces the current draft itself.
    if (!draftHasContent(d) || sending.current) return
    if (saving.current) await saving.current
    if (!quiet) setBusy('draft')
    const run = (async () => {
      try {
        const r = await window.electronAPI.mailLocal!.saveDraft(input())
        if (!r.ok) throw new Error(r.message)
        draftId.current = r.value.draftId
        dirty.current = false
        setSavedAt(Date.now())
      } catch (e) {
        if (!quiet) setError(toErrorMessage(e))
      } finally {
        if (!quiet) setBusy(null)
      }
    })()
    saving.current = run
    await run
    if (saving.current === run) saving.current = null
  }, [d, input])

  // Autosave to Drafts 4 s after the last edit.
  useEffect(() => {
    if (!dirty.current) return
    const timer = window.setTimeout(() => void saveDraft(true), 4000)
    return () => window.clearTimeout(timer)
  }, [d, saveDraft])

  const set = (patch: Partial<ComposeDraft>) => { dirty.current = true; setD((prev) => ({ ...prev, ...patch })) }

  const send = async () => {
    sending.current = true
    setBusy('send')
    setError(null)
    try {
      if (saving.current) await saving.current
      const r = await window.electronAPI.mailLocal!.send({ ...input(), draftId: draftId.current })
      if (!r.ok) throw new Error(r.code === 'external-blocked' ? `${t('inbox.mail.externalBlocked', { domain })}: ${r.message.match(/\(([^)]+)\)\s*$/)?.[1] ?? ''}` : r.message)
      void mail.refresh()
      onClose(true)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      sending.current = false
      setBusy(null)
    }
  }
  const discard = async () => {
    if (saving.current) await saving.current
    setBusy('draft')
    setError(null)
    try {
      if (draftId.current) await mail.act((api) => api.remove([draftId.current!]))
      onClose(false)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const pick = async () => {
    const picked = await window.electronAPI.mailLocal!.pickFiles()
    if (picked.length) { dirty.current = true; setFiles((f) => [...f, ...picked]) }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dropped: MailPickedFile[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      const path = window.electronAPI.getFilePath?.(file)
      if (path) dropped.push({ path, name: file.name, size: file.size, type: file.type || 'application/octet-stream' })
    }
    if (dropped.length) { dirty.current = true; setFiles((f) => [...f, ...dropped]) }
  }

  const field = 'h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted'
  const title = d.mode === 'reply' ? t('inbox.mail.reply') : d.mode === 'replyAll' ? t('inbox.mail.replyAll') : d.mode === 'forward' ? t('inbox.mail.forward') : t('inbox.mail.compose')
  return (
    <form
      className="flex min-h-full flex-col gap-1 px-5 py-4"
      data-testid="mail-composer"
      onSubmit={(e) => { e.preventDefault(); void send() }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() } }}
    >
      <div className="flex items-center gap-2 pb-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-text-muted">{mail.status?.address}</span>
        {savedAt ? <span className="ml-auto text-[11px] text-text-muted">{t('inbox.mail.draftSaved')}</span> : null}
      </div>
      <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.04] px-2">
        <span className="w-12 shrink-0 text-[12px] text-text-muted">{t('inbox.mail.to')}</span>
        <input className={field} value={d.to} onChange={(e) => set({ to: e.target.value })} autoFocus={d.mode !== 'reply' && d.mode !== 'replyAll'} data-testid="mail-to" placeholder={`name@${domain}`} />
        {!showCc ? <button type="button" className="text-[11px] text-text-muted hover:text-foreground" onClick={() => setShowCc(true)}>{t('inbox.mail.showCc')}</button> : null}
        {!showBcc ? <button type="button" className="text-[11px] text-text-muted hover:text-foreground" onClick={() => setShowBcc(true)}>{t('inbox.mail.bcc')}</button> : null}
      </label>
      {showCc ? (
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.04] px-2">
          <span className="w-12 shrink-0 text-[12px] text-text-muted">{t('inbox.mail.cc')}</span>
          <input className={field} value={d.cc} onChange={(e) => set({ cc: e.target.value })} data-testid="mail-cc" />
        </label>
      ) : null}
      {showBcc ? (
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.04] px-2">
          <span className="w-12 shrink-0 text-[12px] text-text-muted">{t('inbox.mail.bcc')}</span>
          <input className={field} value={d.bcc} onChange={(e) => set({ bcc: e.target.value })} data-testid="mail-bcc" />
        </label>
      ) : null}
      <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.04] px-2">
        <span className="w-12 shrink-0 text-[12px] text-text-muted">{t('inbox.mail.subject')}</span>
        <input className={field} value={d.subject} onChange={(e) => set({ subject: e.target.value })} data-testid="mail-subject-input" />
      </label>
      <textarea
        value={d.text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder={t('inbox.mail.bodyPlaceholder')}
        autoFocus={d.mode === 'reply' || d.mode === 'replyAll'}
        ref={(el) => { if (el && (d.mode === 'reply' || d.mode === 'replyAll') && el.selectionStart === el.value.length && !dirty.current) el.setSelectionRange(0, 0) }}
        className="min-h-[240px] flex-1 resize-none rounded-[var(--radius-card)] bg-foreground/[0.04] p-2 text-[13px] leading-[1.5] outline-none"
        data-testid="mail-body"
      />
      {files.length || forwardAtt.length ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {forwardAtt.map((a) => (
            <span key={a.blobId} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] bg-foreground/[0.06] px-2 text-[12px]">
              {a.name} <span className="text-text-muted">{formatBytes(a.size)}</span>
              <button type="button" aria-label={t('inbox.mail.discard')} onClick={() => { dirty.current = true; setForwardAtt((l) => l.filter((x) => x !== a)) }} className="text-text-muted hover:text-foreground">×</button>
            </span>
          ))}
          {files.map((f) => (
            <span key={f.path} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] bg-foreground/[0.06] px-2 text-[12px]" data-testid="mail-file">
              {f.name} <span className="text-text-muted">{formatBytes(f.size)}</span>
              <button type="button" aria-label={t('inbox.mail.discard')} onClick={() => { dirty.current = true; setFiles((l) => l.filter((x) => x !== f)) }} className="text-text-muted hover:text-foreground">×</button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-[12px] text-destructive" data-testid="mail-compose-error">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5 pt-2">
        <Button type="submit" variant="primary" disabled={!!busy} data-testid="mail-send">{busy === 'send' ? t('inbox.mail.sending') : t('inbox.mail.send')}</Button>
        <Button onClick={() => void pick()} disabled={!!busy}>{t('inbox.mail.attach')}</Button>
        <Button variant="ghost" onClick={() => void saveDraft()} disabled={!!busy} data-testid="mail-save-draft">{t('inbox.mail.saveDraft')}</Button>
        <Button variant="ghost" onClick={() => void discard()} disabled={!!busy}>{t('inbox.mail.discard')}</Button>
        {mail.status?.local ? <span className="ml-auto text-[11px] text-text-muted">{t('inbox.mail.externalBlocked', { domain })}</span> : null}
      </div>
    </form>
  )
}

export function useComposeState(mail: MailController) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const [compose, setCompose] = useState<{ draft: ComposeDraft; source: MailMessage | null; key: number } | null>(null)
  const edit = useCallback((m: MailMessage) => setCompose({ draft: draftFromMessage(m), source: null, key: Date.now() }), [])
  const start = useCallback((mode: ComposeMode, source: MailMessage | null) => {
    const header = (m: MailMessage) => (mode === 'forward'
      ? t('inbox.mail.forwardHeader', { from: addressLine(m.from), date: fmt.full(m.receivedAt), subject: m.subject })
      : t('inbox.mail.quoteHeader', { from: addressLabel(m.from[0]), date: fmt.full(m.receivedAt) }))
    setCompose({ draft: buildDraft(mode, source, mail.status?.address ?? null, header), source, key: Date.now() })
  }, [mail.status?.address, t, fmt])
  return { compose, start, edit, close: () => setCompose(null) }
}

export { statusKey }
