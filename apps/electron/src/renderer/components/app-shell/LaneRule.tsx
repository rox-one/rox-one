/**
 * LaneRule (G6 «Пути») — the 14px status gutter of a session-lane row.
 *
 * The rule is *geometry*, not decoration: a 2px mark that grows to the active
 * height for live states and stays quiet for read/idle ones. It is always
 * `aria-hidden` — status is carried by the row's accessible name and by the
 * status icon, never by colour alone (see SessionLanes).
 */
import { cn } from '@/lib/utils'
import type { SessionMeta } from '@/atoms/sessions'
import { hasUnreadMeta } from '@/utils/session'

/** Shared lane vocabulary: one word per state the shell already tracks. */
export type LaneStatus = 'running' | 'waiting' | 'blocked' | 'done' | 'idle'

/**
 * Derive the lane status of one session from its metadata. `pending` is the
 * session's pending permission/admin prompt (`hasPendingPrompt` in the list
 * context) — the only state a row cannot see on its own.
 */
export function deriveLaneStatus(item: SessionMeta, pending = false): LaneStatus {
  if (pending) return 'blocked'
  if (item.isProcessing) return 'running'
  if (hasUnreadMeta(item)) return 'waiting'
  if (item.lastFinalMessageId || item.lastMessageRole === 'assistant' || item.lastMessageRole === 'plan') return 'done'
  return 'idle'
}

/** The rule colour for a status; `null` means "quiet" (no status colour). */
export const LANE_RULE_COLOR: Record<LaneStatus, string | null> = {
  running: 'var(--status-running)',
  waiting: 'var(--status-warning)',
  blocked: 'var(--status-danger)',
  done: 'var(--status-success)',
  idle: null,
}

interface LaneRuleProps {
  status: LaneStatus
  /**
   * Live states (running / waiting / blocked) draw the tall rule; quiet states
   * (done / idle) draw the short one.
   */
  active?: boolean
  className?: string
}

export function LaneRule({ status, active = false, className }: LaneRuleProps) {
  const color = LANE_RULE_COLOR[status]
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center', className)}
      style={{ width: 'var(--lane-gutter-width)' }}
      aria-hidden="true"
      data-lane-rule={status}
    >
      <span
        className="rounded-full transition-[height] duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none"
        style={{
          width: 'var(--lane-rule-width)',
          height: active ? 'var(--lane-rule-active-height)' : 'var(--lane-rule-quiet-height)',
          background: color ?? 'var(--border-strong)',
        }}
      />
    </span>
  )
}