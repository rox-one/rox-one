/**
 * DevSpaceNudgeBanner — «soft signal» reminder (spec 2026-10-09, 02 §2.4/§12).
 *
 * A pasted git link or a detected git install may raise this one-shot banner
 * offering Settings → «Разработчикам». A signal never enables Developer Space:
 * only the explicit role choice or the Settings toggle writes `devspace.v1`.
 *
 * The soft signal is local-only and allowlisted — only the enum `kind` travels,
 * never a repo name, URL or path (attempts mirror the product-tour analytics
 * pattern: finite enums, sanitized, no remote egress).
 */
import { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Code2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  devSpaceEnabledAtom,
  devSpaceNudgeSeenAtom,
  devSpaceReminderStateAtom,
  type DevSpaceReminderState,
} from '@/atoms/dev-space'
import { DEV_SPACE_SOFT_SIGNAL_KINDS, emitDevSpaceEvent } from '@/features/dev-space/analytics'
import type { DevSpaceSoftSignalKind } from '@/features/dev-space/analytics'

/** Local soft-signal channel; nothing leaves the renderer. */
export const DEV_SPACE_SOFT_SIGNAL_EVENT = 'devSpace:softSignal'

export { DEV_SPACE_SOFT_SIGNAL_KINDS }
export type { DevSpaceSoftSignalKind }

export interface DevSpaceSoftSignal {
  readonly eventName: 'devspace.soft-signal'
  readonly kind: DevSpaceSoftSignalKind
}

/** Snooze window applied when the user dismisses the nudge. */
export const DEV_SPACE_NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A bare GitHub repository link — `https://github.com/<owner>/<repo>` with an
 * optional `.git` suffix or trailing slash and nothing else. Used to raise the
 * soft nudge on paste; the pasted text itself is never altered.
 */
export const GITHUB_REPO_LINK_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?\/?$/

export function isGitHubRepoLink(text: string | null | undefined): boolean {
  return typeof text === 'string' && GITHUB_REPO_LINK_PATTERN.test(text.trim())
}

/**
 * Emit a local, allowlisted soft signal. Only the enum `kind` survives — never a
 * repo name, URL or path (02 §12). The same enum is mirrored into the local
 * analytics buffer when the user opted in. Never enables the flag.
 */
export function emitDevSpaceSoftSignal(kind: DevSpaceSoftSignalKind): void {
  if (!(DEV_SPACE_SOFT_SIGNAL_KINDS as readonly unknown[]).includes(kind)) return
  const detail: DevSpaceSoftSignal = { eventName: 'devspace.soft-signal', kind }
  try {
    window.dispatchEvent(new CustomEvent<DevSpaceSoftSignal>(DEV_SPACE_SOFT_SIGNAL_EVENT, { detail }))
  } catch {
    // No window (headless/tests): the signal is dropped and the flag stays off.
  }
  emitDevSpaceEvent({ eventName: 'devSpace:softSignal', kind })
}

/**
 * Whether the nudge should be visible: a soft signal happened, Developer Space
 * is off, and the reminder was neither accepted nor dismissed (nor snoozed).
 * Pure so the state transitions stay testable — never reads the flag.
 */
export function isDevSpaceNudgeVisible(input: {
  enabled: boolean
  seen: boolean | null
  reminder: DevSpaceReminderState
  signaled: boolean
  now?: number
}): boolean {
  if (input.enabled || !input.signaled) return false
  if (input.seen !== null) return false
  return (input.reminder.dismissedUntil ?? 0) <= (input.now ?? Date.now())
}

export function DevSpaceNudgeBanner({ className }: { className?: string }) {
  const { t } = useTranslation()
  const enabled = useAtomValue(devSpaceEnabledAtom)
  const [seen, setSeen] = useAtom(devSpaceNudgeSeenAtom)
  const [reminder, setReminder] = useAtom(devSpaceReminderStateAtom)
  const [signaled, setSignaled] = useState(false)
  const recordedRef = useRef(false)

  useEffect(() => {
    const onSignal = () => setSignaled(true)
    window.addEventListener(DEV_SPACE_SOFT_SIGNAL_EVENT, onSignal)
    return () => window.removeEventListener(DEV_SPACE_SOFT_SIGNAL_EVENT, onSignal)
  }, [])

  const visible = isDevSpaceNudgeVisible({ enabled, seen, reminder, signaled })

  // The first paint of the nudge records the soft-signal bookkeeping (one-shot).
  useEffect(() => {
    if (!visible || recordedRef.current) return
    recordedRef.current = true
    setReminder((previous) => ({
      ...previous,
      count: previous.count + 1,
      lastShownAt: Date.now(),
    }))
  }, [visible, setReminder])

  if (!visible) return null

  return (
    <div
      className={cn(
        'shrink-0 border-b border-accent/30 bg-accent/10 px-4 py-2 text-accent',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Code2 className="icon-inline shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t('devSpace.nudge.title')}</p>
            <p className="truncate text-xs text-muted-foreground">{t('devSpace.nudge.description')}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          onClick={() => {
            setSeen(true)
            navigate(routes.view.settings('developers'))
          }}
        >
          {t('devSpace.nudge.action')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setReminder((previous) => ({
              ...previous,
              dismissedUntil: Date.now() + DEV_SPACE_NUDGE_SNOOZE_MS,
            }))
            setSeen(false)
          }}
          aria-label={t('common.dismiss')}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="icon-caption" />
        </button>
      </div>
    </div>
  )
}