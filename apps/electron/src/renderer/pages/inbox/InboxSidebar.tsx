import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, Bell, BrainCircuit, CalendarDays, CheckCheck, ChevronRight,
  Clock3, FileCheck2, FilePenLine, Inbox, KeyRound, Mail, MessageCircle,
  Send, ShieldCheck, Sparkles, TriangleAlert, Trash2, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { NavTitle, type Tone } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import type { MailFolder, MailFolderRole } from '../../../shared/mail-local'
import { DECISION_KINDS, type InboxFilter, type InboxKind } from './inbox-model'
import { folderLabel } from './mail/MailPanels'
import { statusKey } from './mail/mail-view'
import type { MailController } from './mail/useMail'

export type InboxPageFilter = InboxFilter | { mail: string }

export function isMailFilter(filter: InboxPageFilter): filter is { mail: string } {
  return typeof filter === 'object' && 'mail' in filter
}

export function sameInboxFilter(a: InboxPageFilter, b: InboxPageFilter): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (isMailFilter(a) || isMailFilter(b)) return isMailFilter(a) && isMailFilter(b) && a.mail === b.mail
  return a.kind === b.kind
}

const KIND_ICONS: Record<InboxKind, LucideIcon> = {
  permission: ShieldCheck,
  credential: KeyRound,
  plan: FileCheck2,
  memory: BrainCircuit,
  skill: Sparkles,
  sender: UserPlus,
  reply: MessageCircle,
  error: TriangleAlert,
  mail: Mail,
  'team-recipient': Users,
}

const KIND_TONES: Record<InboxKind, Tone> = {
  permission: 'warning', credential: 'warning', plan: 'accent',
  memory: 'info', skill: 'accent', sender: 'success', reply: 'info',
  error: 'danger', mail: 'info', 'team-recipient': 'success',
}

const ICON_TONE: Record<Tone, string> = {
  accent: 'bg-accent/10 text-accent',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  success: 'bg-success/10 text-success',
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-[var(--warning,#d9a13b)]/10 text-[var(--warning,#d9a13b)]',
  muted: 'bg-foreground/[0.05] text-text-muted',
}

const FOLDER_ICONS: Record<MailFolderRole, LucideIcon> = {
  inbox: Inbox, drafts: FilePenLine, sent: Send,
  archive: Archive, junk: ShieldCheck, trash: Trash2,
}

export function InboxKindIcon({ kind }: { kind: InboxKind }) {
  const Icon = KIND_ICONS[kind]
  return <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-lg', ICON_TONE[KIND_TONES[kind]])}><Icon className="size-3.5" strokeWidth={1.75} /></span>
}

function Count({ count, urgent }: { count?: number; urgent?: boolean }) {
  return count ? <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums', urgent ? 'bg-[var(--warning,#d9a13b)]/15 text-[var(--warning,#d9a13b)]' : 'bg-foreground/[0.05] text-text-muted')}>{count}</span> : null
}

function InboxNavButton({ label, count, active, icon: Icon, tone = 'muted', onClick, testId }: {
  label: string; count?: number; active?: boolean; icon: LucideIcon; tone?: Tone
  onClick: () => void; testId: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={cn('flex min-h-8 w-full items-center gap-2 rounded-lg border-l-2 border-transparent px-2 py-1 text-left text-[12px] outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'border-l-accent bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground')}>
      <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-lg', ICON_TONE[tone])}><Icon className="size-3.5" strokeWidth={1.75} /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Count count={count} />
    </button>
  )
}

function InboxNavGroup({ id, label, icon: Icon, tone, count, urgent, active, initialOpen = false, children }: {
  id: string; label: string; icon: LucideIcon; tone: Tone; count?: number
  urgent?: boolean; active?: boolean; initialOpen?: boolean; children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  // A newly selected descendant must be revealed, while manual folding survives data refreshes.
  useEffect(() => { if (active && ref.current) ref.current.open = true }, [active])
  return (
    <details ref={ref} open={initialOpen || active} data-testid={`inbox-group-${id}`} className="group/inbox-nav mt-1">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.05] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-lg', ICON_TONE[tone])}><Icon className="size-3.5" strokeWidth={1.75} /></span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Count count={count} urgent={urgent} />
        <ChevronRight aria-hidden className="size-3 shrink-0 text-text-muted transition-transform duration-200 group-open/inbox-nav:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="ml-5 flex flex-col gap-0.5 border-l border-foreground/10 py-1 pl-2">{children}</div>
    </details>
  )
}

export interface InboxSidebarCounts {
  all: number; decisions: number; messages: number; snoozed: number; done: number
  blocking: number; byKind: Record<InboxKind, number>
}

export function InboxSidebar({ filter, counts, onSelect, mail, onSelectFolder, onOpenMeetings, onConnectTeam, teamNeedsConnection }: {
  filter: InboxPageFilter; counts: InboxSidebarCounts; onSelect: (filter: InboxFilter) => void
  mail: MailController; onSelectFolder: (folder: MailFolder) => void
  onOpenMeetings: () => void; onConnectTeam: () => void; teamNeedsConnection: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const inMail = isMailFilter(filter)
  const selectedKind = typeof filter === 'object' && !inMail ? filter.kind : null
  const status = mail.status
  const copyAddress = async () => {
    if (!status?.address) return
    try {
      await navigator.clipboard.writeText(status.address)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch { /* Native clipboard may be unavailable; the address remains selectable. */ }
  }
  const kindButton = (kind: InboxKind) => <InboxNavButton key={kind} label={t(`inbox.kind.${kind}`)} count={counts.byKind[kind]} active={sameInboxFilter(filter, { kind })} icon={KIND_ICONS[kind]} tone={KIND_TONES[kind]} onClick={() => onSelect({ kind })} testId={`inbox-nav-${kind}`} />
  return (
    <div data-inbox-sidebar data-focus-zone="sidebar" onKeyDown={handleSidebarTreeKeyDown}>
      <NavTitle>{t('inbox.title')}</NavTitle>
      <InboxNavButton label={t('inbox.view.all')} count={counts.all} active={filter === 'all'} icon={Inbox} tone="accent" onClick={() => onSelect('all')} testId="inbox-nav-all" />
      <InboxNavGroup id="decisions" label={t('inbox.view.decisions')} icon={ShieldCheck} tone="warning" count={counts.decisions} urgent={counts.blocking > 0} initialOpen active={filter === 'decisions' || !!selectedKind && DECISION_KINDS.includes(selectedKind)}>
        <InboxNavButton label={t('inbox.nav.allDecisions')} count={counts.decisions} active={filter === 'decisions'} icon={FileCheck2} tone="warning" onClick={() => onSelect('decisions')} testId="inbox-nav-decisions" />
        {DECISION_KINDS.map(kindButton)}
      </InboxNavGroup>
      <InboxNavGroup id="notifications" label={t('inbox.nav.notifications')} icon={Bell} tone="info" count={counts.messages} initialOpen active={filter === 'messages' || selectedKind === 'reply' || selectedKind === 'error'}>
        <InboxNavButton label={t('inbox.nav.allNotifications')} count={counts.messages} active={filter === 'messages'} icon={Bell} tone="info" onClick={() => onSelect('messages')} testId="inbox-nav-messages" />
        {kindButton('reply')}{kindButton('error')}
      </InboxNavGroup>
      <InboxNavGroup id="mail" label={t('inbox.mail.section')} icon={Mail} tone="info" count={counts.byKind.mail} active={inMail}>
        {status?.state === 'ready' && status.address ? (
          <div className="flex min-w-0 items-center gap-1 px-2 pb-1 text-[11px]" data-testid="mail-address">
            <span className="min-w-0 flex-1 select-text truncate text-text-secondary" title={status.address}>{status.address}</span>
            <button type="button" onClick={() => void copyAddress()} className="shrink-0 rounded-md px-1.5 py-1 text-text-muted outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring" data-testid="mail-copy">{t(copied ? 'inbox.mail.copied' : 'inbox.mail.copy')}</button>
          </div>
        ) : <p className="px-2 pb-1 text-[11px] text-text-muted">{t(statusKey(status), { address: status?.address ?? '', url: status?.serverUrl ?? '', error: status?.error ?? '', flag: status?.flag ?? '' })}</p>}
        {status?.state === 'ready' ? mail.folders.map((folder) => (
          <InboxNavButton key={folder.id} label={folderLabel(t, folder)} count={folder.role === 'drafts' || folder.role === 'sent' ? folder.total : folder.unread} active={inMail && filter.mail === folder.id} icon={folder.role ? FOLDER_ICONS[folder.role] : Mail} tone={folder.role === 'junk' || folder.role === 'trash' ? 'muted' : 'info'} onClick={() => onSelectFolder(folder)} testId={`mail-folder-${folder.role ?? folder.id}`} />
        )) : <InboxNavButton label={t('inbox.kind.mail')} active={inMail && filter.mail === 'inbox'} icon={Inbox} tone="muted" onClick={() => onSelectFolder({ id: 'inbox', name: t('inbox.mail.folder.inbox'), role: 'inbox', total: 0, unread: 0 })} testId="mail-folder-inbox" />}
      </InboxNavGroup>
      <div className="mt-3 space-y-0.5 border-t border-foreground/[0.06] pt-2">
        <InboxNavButton label={t('inbox.view.snoozed')} count={counts.snoozed} active={filter === 'snoozed'} icon={Clock3} tone="warning" onClick={() => onSelect('snoozed')} testId="inbox-nav-snoozed" />
        <InboxNavButton label={t('inbox.view.done')} count={counts.done} active={filter === 'done'} icon={CheckCheck} tone="success" onClick={() => onSelect('done')} testId="inbox-nav-done" />
      </div>
      <InboxNavGroup id="connections" label={t('inbox.notConnected')} icon={Users} tone="muted">
        <InboxNavButton label={t('inbox.kind.meetingProposals')} icon={CalendarDays} tone="muted" onClick={onOpenMeetings} testId="inbox-nav-meetings" />
        {teamNeedsConnection ? <InboxNavButton label={t('teamCollab.inboxNav')} icon={Users} tone="muted" onClick={onConnectTeam} testId="inbox-nav-team" /> : null}
      </InboxNavGroup>
    </div>
  )
}
