/**
 * Message bodies for the team messenger: plain text with link / file cards,
 * localized call system events, and transcript / AI-summary cards.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, Link2, PhoneCall, PhoneOff, ScrollText, Sparkles } from 'lucide-react'
import type { TeamChannelMessage } from '@rox/shared/team-chat'
import { cn } from '@/lib/utils'

const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»]/g
const FILE_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|fig|sketch|png|jpe?g|gif|webp|mp4|mov|mp3|wav|txt|md|json)$/i

/** URLs in a message, deduped, in order. Exported for tests. */
export function extractLinks(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])].slice(0, 5)
}

export function linkCardKind(url: string): 'file' | 'link' {
  try { return FILE_EXT_RE.test(new URL(url).pathname) ? 'file' : 'link' } catch { return 'link' }
}

function linkLabel(url: string): { title: string; host: string } {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    return { title: last || u.hostname, host: u.hostname.replace(/^www\./, '') }
  } catch { return { title: url, host: '' } }
}

function LinkCard({ url }: { url: string }) {
  const kind = linkCardKind(url)
  const { title, host } = linkLabel(url)
  const Icon = kind === 'file' ? FileText : Link2
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" data-testid={`messenger-${kind}-card`}
      className="mt-1.5 flex max-w-md items-center gap-2 rounded-md border border-border/60 bg-surface-raised px-2.5 py-1.5 text-small hover:bg-surface-hover">
      <Icon className="size-3.5 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-accent">{title}</span>
      {host ? <span className="shrink-0 text-caption text-text-muted">{host}</span> : null}
    </a>
  )
}

export function MessageBody({ message, nameOf }: { message: TeamChannelMessage; nameOf: (id: string) => string }) {
  const { t } = useTranslation()
  if (message.kind === 'system') {
    const started = message.event === 'call.started'
    const Icon = started ? PhoneCall : PhoneOff
    return (
      <p className="flex items-center gap-1.5 text-caption text-text-muted" data-testid="messenger-call-event">
        <Icon className="size-3.5" aria-hidden />
        {started ? t('messenger.calls.startedBy', { name: nameOf(message.senderId) }) : t('messenger.calls.ended')}
      </p>
    )
  }
  if (message.kind === 'transcript') return <TranscriptCard message={message} />
  if (message.kind === 'summary') {
    return (
      <div className="max-w-2xl rounded-md border border-accent/30 bg-accent/5 px-3 py-2" data-testid="messenger-call-summary">
        <p className="mb-1 flex items-center gap-1.5 text-caption font-medium text-accent"><Sparkles className="size-3.5" aria-hidden />{t('messenger.calls.summary')}</p>
        <p className="whitespace-pre-wrap break-words text-body">{message.text}</p>
      </div>
    )
  }
  const links = extractLinks(message.text)
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-body">{message.text}</p>
      {links.map(url => <LinkCard key={url} url={url} />)}
    </>
  )
}

function TranscriptCard({ message }: { message: TeamChannelMessage }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const lines = message.text.split('\n')
  return (
    <div className="max-w-2xl rounded-md border border-border/60 bg-surface-raised px-3 py-2" data-testid="messenger-call-transcript">
      <button type="button" className="flex w-full items-center gap-1.5 text-caption font-medium text-text-secondary" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        <ScrollText className="size-3.5" aria-hidden />
        {t('messenger.calls.transcript', { count: lines.length })}
      </button>
      <pre className={cn('mt-1 whitespace-pre-wrap break-words font-sans text-small', !open && 'line-clamp-3')}>{message.text}</pre>
    </div>
  )
}
