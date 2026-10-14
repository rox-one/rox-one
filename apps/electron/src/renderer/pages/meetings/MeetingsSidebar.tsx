import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, CalendarBlank, CalendarCheck, CalendarDots, CaretRight, Microphone, Plugs, Radio,
  Tray, Waveform, WarningCircle, ListChecks,
} from '@phosphor-icons/react'
import type { PhosphorIcon } from '@/platform/phosphor-glyphs'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { NAV_CHILDREN_CLASS, NAV_ROW_ACTIVE_CLASS, NAV_ROW_CLASS, NAV_ROW_IDLE_CLASS, NavTitle } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import type { LocalAsrEngine } from '../../../shared/meetings-local'
import type { LocalBucket } from './local-meetings-model'

type IconTone = 'violet' | 'sky' | 'orange' | 'pink' | 'green' | 'muted'

function NavIcon({ icon: Icon, tone }: { icon: PhosphorIcon; tone: IconTone }) {
  // Bare 16px glyph (icon-inline) in muted grey: no tinted box (Mark 2026-10-14).
  return <Icon aria-hidden data-tone={tone} className="icon-inline text-text-muted" />
}

function Count({ count }: { count?: number }) {
  return count ? <span className="shrink-0 text-caption numeric text-text-muted">{count}</span> : null
}

function MeetingsNavButton({ label, count, active, icon, tone, onClick, testId }: {
  label: string; count?: number; active?: boolean; icon: PhosphorIcon; tone: IconTone
  onClick: () => void; testId: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={cn(NAV_ROW_CLASS, active ? NAV_ROW_ACTIVE_CLASS : NAV_ROW_IDLE_CLASS)}>
      <NavIcon icon={icon} tone={tone} />
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
      <Count count={count} />
    </button>
  )
}

function MeetingsNavGroup({ id, label, icon, tone, active, revealKey, initialOpen = false, children }: {
  id: string; label: string; icon: PhosphorIcon; tone: IconTone; active?: boolean
  revealKey?: string; initialOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(initialOpen || Boolean(active))
  // Reveal newly selected filters, without reopening a manually folded group on refresh.
  useEffect(() => { if (active) setOpen(true) }, [active, revealKey])
  return (
    <details open={open} onToggle={(event) => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
    }} data-testid={`meetings-group-${id}`} >
      <summary className={cn(NAV_ROW_CLASS, 'cursor-pointer list-none text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground [&::-webkit-details-marker]:hidden')}>
        <NavIcon icon={icon} tone={tone} />
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        <CaretRight aria-hidden className={cn('icon-status shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
      </summary>
      <div className={cn(NAV_CHILDREN_CLASS, 'pt-px')}>{children}</div>
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
  const bucketButton = (value: LocalBucket, icon: PhosphorIcon, tone: IconTone) => (
    <MeetingsNavButton label={t(value === 'needsAction' ? 'meetings.local.needsAction' : `meetings.screen.${value}`)} count={counts[value]} active={bucket === value} icon={icon} tone={tone} onClick={() => onBucketSelect(value)} testId={`meetings-nav-${value}`} />
  )
  return (
    <div data-meetings-sidebar data-focus-zone="sidebar" className="flex flex-col gap-px" onKeyDown={handleSidebarTreeKeyDown}>
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
        html[data-render-profile="performance"] [data-meetings-sidebar] details::details-content { transition: none; }
      `}</style>
      <NavTitle>{t('meetings.title')}</NavTitle>
      {bucketButton('all', Tray, 'violet')}
      <MeetingsNavGroup id="calendar" label={t('meetings.nav.calendar')} icon={CalendarBlank} tone="sky" initialOpen active={calendarActive} revealKey={bucket}>
        {bucketButton('today', CalendarCheck, 'sky')}
        {bucketButton('upcoming', CalendarDots, 'green')}
        {bucketButton('past', Archive, 'muted')}
      </MeetingsNavGroup>
      <MeetingsNavGroup id="activity" label={t('meetings.nav.activity')} icon={ListChecks} tone="orange" initialOpen active={activityActive} revealKey={bucket}>
        {bucketButton('live', Radio, 'pink')}
        {bucketButton('needsAction', WarningCircle, 'orange')}
      </MeetingsNavGroup>
      <div className="mt-2 flex flex-col gap-px border-t border-border-subtle pt-2">
        <MeetingsNavGroup id="transcription" label={t('meetings.local.transcription')} icon={Waveform} tone="green">
          {engine ? (
            <div className="flex items-start gap-2 px-2 py-1 text-body" data-testid="meetings-engine">
              <NavIcon icon={Microphone} tone={engine.ready ? 'green' : 'orange'} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-text-secondary">{engine.ready ? `${engine.engine} · ${engine.model}` : t('meetings.local.engineMissing')}</span>
                <span className="block break-words text-xs text-text-muted">{engine.ready ? t('meetings.nav.engineLocal') : t('meetings.local.engineHowTo', { missing: engine.missing.map((key) => t(`meetings.local.missing.${key}`)).join(', ') })}</span>
              </span>
            </div>
          ) : <p className="px-2 py-1 text-xs text-text-muted">{t('meetings.local.engineMissing')}</p>}
        </MeetingsNavGroup>
        <MeetingsNavGroup id="sources" label={t('meetings.screen.sources')} icon={Plugs} tone="sky">
          <MeetingsNavButton label={t('meetings.screen.calendarsNone')} icon={CalendarDots} tone="muted" onClick={onConnectCalendar} testId="meetings-connect-calendar" />
        </MeetingsNavGroup>
      </div>
    </div>
  )
}
