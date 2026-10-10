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
import { LogOut, Settings } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import type { ProfileStripData } from './ProfileStrip'

/** Row styling mirrors `StyledDropdownMenuItem` so the popover matches native menus. */
const rowClass = cn(
  'relative flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left',
  'text-[length:var(--menu-font-size)] leading-5 outline-hidden select-none',
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

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] p-2">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-text-primary" title={displayName}>{displayName}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            <span className="truncate rounded-md bg-surface-hover px-1.5 font-medium text-text-secondary">
              {planLabel}
            </span>
            <span className="shrink-0 numeric text-text-secondary">
              {t('profile.level', { level: data.level })}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-1 my-0.5 h-px bg-border-subtle" />

      <dl className="space-y-2 px-3 pt-1 pb-2 text-caption">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('profile.balanceLabel')}</dt>
          <dd
            data-testid="profile-popover-balance"
            className={cn('numeric', balanceKnown ? 'text-text-primary' : 'text-muted-foreground')}
          >
            {balanceLabel}
          </dd>
        </div>
        {spentLabel ? (
          <div className="flex items-center justify-between gap-3" title={t('profile.spentTooltip')}>
            <dt className="text-muted-foreground">{t('profile.spent', { amount: '' }).trim()}</dt>
            <dd className="numeric text-text-secondary">{spentLabel}</dd>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3" title={t('settings.account.xpHint')}>
            <dt className="text-muted-foreground">{t('settings.account.xp')}</dt>
            <dd className="numeric text-text-primary">{xpLabel}</dd>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-label={t('settings.account.progressSection')}
            className="h-1 overflow-hidden rounded-full bg-surface-pressed"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </dl>

      <div className="mx-1 my-0.5 h-px bg-border-subtle" />

      <button type="button" className={rowClass} onClick={onOpenAccountSettings}>
        <Settings className="icon-toolbar shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{t('profile.accountSettings')}</span>
      </button>
      <button
        type="button"
        className={destructiveRowClass}
        onClick={() => void handleSignOut()}
      >
        <LogOut className="icon-toolbar shrink-0" aria-hidden />
        <span className="font-medium">{t('settings.accounts.signOut')}</span>
      </button>
    </div>
  )
}