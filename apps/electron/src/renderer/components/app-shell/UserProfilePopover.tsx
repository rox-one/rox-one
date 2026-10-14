/**
 * User profile popover content — the native-styled identity surface opened by
 * the sidebar profile plate (ProfileStrip).
 *
 * Shows the signed-in display name, plan, current level and XP progress, the
 * cloud balance (personal cabinet snapshot; never a placeholder dash) and the
 * workspace spend, then the account actions: account settings and sign-out.
 *
 * The sign-out flow lives here, not in ProfileStrip, so the plate stays a pure
 * navigation trigger and never carries secret-bearing actions itself.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap, LogOut, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import type { ProfileStripData } from './ProfileStrip'
import { requestGuidedTour } from '@/features/guided-tour/model'

/** Row styling mirrors `StyledDropdownMenuItem` so the popover matches native menus. */
const rowClass = cn(
  'relative flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left',
  'text-caption leading-4 outline-hidden select-none',
  '[&_svg]:pointer-events-none',
  'text-text-primary transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover focus:bg-surface-pressed',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
)

/** Destructive variant: red label and icon, matching `StyledDropdownMenuItem`'s destructive item. */
const destructiveRowClass = cn(
  rowClass,
  'text-destructive hover:text-destructive focus:text-destructive [&_svg]:text-destructive',
)

export interface UserProfilePopoverContentProps {
  data: ProfileStripData
  planLabel: string
  /** Amount text, or the neutral "no data" status when the cabinet has no value. */
  balanceLabel: string
  balanceKnown: boolean
  spentLabel: string | null
  /** Pre-rendered round avatar element (kept in a single place by ProfileStrip). */
  avatar: React.ReactNode
  onOpenAccountSettings: () => void
  /** Sidebar v2: app settings live here (no gear in the sidebar footer). */
  onOpenSettings?: () => void
  /** Replays the onboarding product tour. */
  onReplayTour?: () => void
  onClose: () => void
}

export function UserProfilePopoverContent({
  data,
  planLabel,
  balanceLabel,
  balanceKnown,
  spentLabel,
  avatar,
  onOpenAccountSettings,
  onOpenSettings,
  onReplayTour,
  onClose,
}: UserProfilePopoverContentProps) {
  const { t } = useTranslation()
  const displayName = data.displayName.trim() || t('profile.defaultName')
  const xpLabel =
    data.nextThreshold == null
      ? t('profile.xpMax', { xp: data.xp })
      : t('profile.xpProgress', { current: data.xp, next: data.nextThreshold })
  const progressPct = Math.max(0, Math.min(100, Math.round((data.progress ?? 0) * 100)))

  const handleSignOut = async () => {
    try {
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return
      onClose()
      await window.electronAPI.logout()
      toast.success(t('settings.accounts.disconnected'))
    } catch {
      toast.error(t('settings.accounts.disconnectFailed', { message: t('common.failed') }))
    }
  }

  // Settings is one entry: account lives inside Settings.
  const openSettings = onOpenSettings ?? onOpenAccountSettings
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-2" data-testid="profile-popover-header">
        <span className="flex size-8 shrink-0 [&>*]:!size-8">{avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption font-medium leading-4 text-text-primary" title={displayName}>{displayName}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-mark text-muted-foreground">
            <span data-testid="profile-popover-plan" className="inline-flex h-[10px] shrink-0 items-center rounded-full bg-surface-hover px-1 text-mark font-semibold uppercase leading-none tracking-wide text-text-secondary">{planLabel}</span>
            <span className="shrink-0 numeric">{t('profile.level', { level: data.level })}</span>
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
              aria-label={`${t('settings.account.progressSection')}: ${xpLabel}`}
              title={xpLabel}
              className="h-0.5 min-w-6 flex-1 overflow-hidden rounded-full bg-surface-pressed"
            >
              <span className="block h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
            </span>
          </div>
        </div>
      </div>

      {balanceKnown || spentLabel ? (
        <dl className="space-y-1 border-t border-border-subtle px-2 py-1.5 text-caption leading-4">
          {balanceKnown ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('profile.balanceLabel')}</dt>
              <dd data-testid="profile-popover-balance" className="numeric text-text-primary">{balanceLabel}</dd>
            </div>
          ) : null}
          {spentLabel ? (
            <div className="flex items-center justify-between gap-3" title={t('profile.spentTooltip')}>
              <dt className="text-muted-foreground">{t('profile.spent', { amount: '' }).trim()}</dt>
              <dd className="numeric text-text-secondary">{spentLabel}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="border-t border-border-subtle pt-1">
        <button type="button" className={rowClass} onClick={openSettings} data-testid="profile-open-settings">
          <SlidersHorizontal className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
          <span>{t('sidebar.settings')}</span>
        </button>
        <button type="button" className={rowClass} onClick={() => { onClose?.(); requestGuidedTour() }} data-testid="profile-start-tour">
          <GraduationCap className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
          <span>{t('guidedTour.relaunch')}</span>
        </button>
        {onReplayTour ? (
          <button type="button" className={rowClass} onClick={onReplayTour} data-testid="profile-replay-tour">
            <RotateCcw className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('profile.replayTour')}</span>
          </button>
        ) : null}
        <button type="button" className={destructiveRowClass} onClick={() => void handleSignOut()}>
          <LogOut className="icon-caption shrink-0" aria-hidden />
          <span>{t('settings.accounts.signOut')}</span>
        </button>
      </div>
    </div>
  )
}