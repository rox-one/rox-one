/**
 * Title-bar recording indicator — visible on every screen while a meeting is
 * being recorded; click opens the meeting. Renders nothing when idle.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { navigate, routes } from '@/lib/navigate'
import { recordedMs, useRecorder } from '@/lib/meetings/recorder'
import { cn } from '@/lib/utils'

export function formatRecClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

export function MeetingRecordingIndicator() {
  const { t } = useTranslation()
  const rec = useRecorder()
  const [, tick] = useState(0)
  const active = rec.status === 'recording' || rec.status === 'paused' || rec.status === 'stopping'
  useEffect(() => {
    if (rec.status !== 'recording') return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [rec.status])
  if (!active || !rec.meetingId) return null
  const paused = rec.status === 'paused'
  const label = rec.status === 'stopping' ? t('meetings.local.saving') : paused ? t('meetings.local.paused') : t('meetings.local.recShort')
  return (
    <button
      type="button"
      data-testid="meeting-rec-indicator"
      onClick={() => navigate(routes.view.meetings(rec.meetingId ?? undefined))}
      title={t('meetings.local.recIndicatorTitle', { title: rec.title })}
      className="titlebar-no-drag ml-2 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-destructive/12 px-2 font-sans text-[12px] font-medium text-destructive hover:bg-destructive/20"
    >
      <span aria-hidden className={cn('size-2 rounded-full bg-destructive', !paused && 'animate-pulse')} />
      <span>{label}</span>
      <span className="tabular-nums">{formatRecClock(recordedMs(rec))}</span>
    </button>
  )
}
