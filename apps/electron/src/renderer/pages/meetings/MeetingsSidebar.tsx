import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, AudioLines, CalendarCheck2, CalendarClock, CalendarDays, ChevronRight,
  CircleAlert, Inbox, ListChecks, Mic, PlugZap, Radio, type LucideIcon,
} from 'lucide-react'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { NavTitle } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import type { LocalAsrEngine } from '../../../shared/meetings-local'
import type { LocalBucket } from './local-meetings-model'

type IconTone = 'violet' | 'sky' | 'orange' | 'pink' | 'green' | 'muted'

const ICON_TONE: Record<IconTone, string> = {
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
  pink: 'bg-pink-500/10 text-pink-600 dark:text-pink-300',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  muted: 'bg-foreground/[0.05] text-text-muted',
}

function NavIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: IconTone }) {
  return <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-lg', ICON_TONE[tone])}><Icon className="size-3.5" strokeWidth={1.75} /></span>
}

function Count({ count }: { count?: number }) {
  return count ? <span className="shrink-0 rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">{count}</span> : null
}

function MeetingsNavButton({ label, count, active, icon, tone, onClick, testId }: {
  label: string; count?: number; active?: boolean; icon: LucideIcon; tone: IconTone
  onClick: () => void; testId: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={cn('flex min-h-8 w-full items-center gap-2 rounded-lg border-l-2 border-transparent px-2 py-1 text-left text-[12px] outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'border-l-accent bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground')}>
      <NavIcon icon={icon} tone={tone} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Count count={count} />
    </button>
  )
}

function MeetingsNavGroup({ id, label, icon, tone, active, revealKey, initialOpen = false, children }: {
  id: string; label: string; icon: LucideIcon; tone: IconTone; active?: boolean
  revealKey?: string; initialOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(initialOpen || Boolean(active))
  // Reveal newly selected filters, without reopening a manually folded group on refresh.
  useEffect(() => { if (active) setOpen(true) }, [active, revealKey])
  return (
    <details open={open} onToggle={(event) => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
    }} data-testid={`meetings-group-${id}`} className="mt-1">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.05] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <NavIcon icon={icon} tone={tone} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
      </summary>
      <div className="ml-5 flex flex-col gap-0.5 border-l border-foreground/10 py-1 pl-2">{children}</div>
    </details>
  )
}

export function MeetingsSidebar({ bucket, counts, engine, onBucketSelect, onConnectCalendar }: {
  bucket: LocalBucket; counts: Record<LocalBucket, number>; engine: LocalAsrEngine | null
  onBucketSelect: (bucket: LocalBucket) => void; onConnectCalendar: () => void
}) {
  const { t } = useTranslation()
  const calendarActive = bucket === 'today' || bucket === 'upcoming' || bucket === 'past'
  const activityActive = bucket === 'live' || bucket === 'needsAction'
  const bucketButton = (value: LocalBucket, icon: LucideIcon, tone: IconTone) => (
    <MeetingsNavButton label={t(value === 'needsAction' ? 'meetings.local.needsAction' : `meetings.screen.${value}`)} count={counts[value]} active={bucket === value} icon={icon} tone={tone} onClick={() => onBucketSelect(value)} testId={`meetings-nav-${value}`} />
  )
  return (
    <div data-meetings-sidebar data-focus-zone="sidebar" onKeyDown={handleSidebarTreeKeyDown}>
      <style>{`
        @supports (interpolate-size: allow-keywords) {
          [data-meetings-sidebar] details { interpolate-size: allow-keywords; }
          [data-meetings-sidebar] details::details-content {
            height: 0; overflow: hidden; opacity: 0;
            transition: height 180ms ease, opacity 180ms ease, content-visibility 180ms allow-discrete;
          }
          [data-meetings-sidebar] details[open]::details-content { height: auto; opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-meetings-sidebar] details::details-content { transition: none; }
        }
      `}</style>
      <NavTitle>{t('meetings.title')}</NavTitle>
      {bucketButton('all', Inbox, 'violet')}
      <MeetingsNavGroup id="calendar" label={t('meetings.nav.calendar')} icon={CalendarDays} tone="sky" initialOpen active={calendarActive} revealKey={bucket}>
        {bucketButton('today', CalendarCheck2, 'sky')}
        {bucketButton('upcoming', CalendarClock, 'green')}
        {bucketButton('past', Archive, 'muted')}
      </MeetingsNavGroup>
      <MeetingsNavGroup id="activity" label={t('meetings.nav.activity')} icon={ListChecks} tone="orange" initialOpen active={activityActive} revealKey={bucket}>
        {bucketButton('live', Radio, 'pink')}
        {bucketButton('needsAction', CircleAlert, 'orange')}
      </MeetingsNavGroup>
      <div className="mt-3 border-t border-foreground/[0.06] pt-2">
        <MeetingsNavGroup id="transcription" label={t('meetings.local.transcription')} icon={AudioLines} tone="green">
          {engine ? (
            <div className="flex items-start gap-2 px-2 py-1 text-[12px]" data-testid="meetings-engine">
              <NavIcon icon={Mic} tone={engine.ready ? 'green' : 'orange'} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-text-secondary">{engine.ready ? `${engine.engine} · ${engine.model}` : t('meetings.local.engineMissing')}</span>
                <span className="block break-words text-[11px] text-text-muted">{engine.ready ? t('meetings.nav.engineLocal') : t('meetings.local.engineHowTo', { missing: engine.missing.map((key) => t(`meetings.local.missing.${key}`)).join(', ') })}</span>
              </span>
            </div>
          ) : <p className="px-2 py-1 text-[11px] text-text-muted">{t('meetings.local.engineMissing')}</p>}
        </MeetingsNavGroup>
        <MeetingsNavGroup id="sources" label={t('meetings.screen.sources')} icon={PlugZap} tone="sky">
          <MeetingsNavButton label={t('meetings.screen.calendarsNone')} icon={CalendarClock} tone="muted" onClick={onConnectCalendar} testId="meetings-connect-calendar" />
        </MeetingsNavGroup>
      </div>
    </div>
  )
}
