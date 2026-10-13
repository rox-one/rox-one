/**
 * Sidebar profile strip — identity trigger for the signed-in user.
 *
 * Opens the user profile popover (name, plan, level, balance and account
 * actions). Account switching stays in AccountMenu. Level and XP details also
 * live on the account page. This strip shows name, plan, level, and balance.
 * It is the only place the balance and the workspace spend are shown (the
 * titlebar and status bar no longer carry cost/usage chips).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatCostUsd } from './input/turn-progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UserProfilePopoverContent } from './UserProfilePopover'
import blackInkAvatar from '@/assets/rox-avatar-ink-black.png'
import whiteInkAvatar from '@/assets/rox-avatar-ink-white.png'
import type { ProfilePlan } from '../../../shared/types'

/**
 * Default Rox user mark: black ink art on light surfaces, white ink art on
 * dark ones. The pair is theme-aware on its own — no `dark:invert`.
 */
function RoxInkAvatarArt() {
  return (
    <>
      <img
        src={blackInkAvatar}
        alt=""
        draggable={false}
        className="h-full w-full object-cover dark:hidden"
      />
      <img
        src={whiteInkAvatar}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="hidden h-full w-full object-cover dark:block"
      />
    </>
  )
}

export interface ProfileStripData {
  displayName: string
  avatar?: string
  plan?: ProfilePlan
  level: number
  xp: number
  progress: number
  xpIntoLevel: number
  xpForNext: number
  nextThreshold: number | null
  balance: number | null
  /** Total model spend (USD) across the workspace's sessions; null when unknown. */
  spentUsd?: number | null
}

interface ProfileStripProps {
  data: ProfileStripData
  onClick: () => void
  className?: string
  defaultAvatarFallback?: React.ReactNode
  /** Avatar-only presentation for the collapsed navigation rail. */
  compact?: boolean
}

export function ProfileStrip({
  data,
  onClick,
  className,
  defaultAvatarFallback,
  compact = false,
}: ProfileStripProps) {
  const { t } = useTranslation()
  const detailsId = React.useId()
  const [open, setOpen] = React.useState(false)
  const displayName = data.displayName.trim() || t('profile.defaultName')
  const plan = data.plan ?? 'standard'
  const planLabel = t(`settings.account.plan.${plan}`)
  const balanceKnown = data.balance !== null && Number.isFinite(data.balance)
  // Every surface — the visible row, the hover title and the screen-reader
  // description — reports the same honest "no data" status instead of a dash,
  // so an unknown cabinet balance can never look like a real zero.
  const descriptionBalance = balanceKnown ? t('profile.balance', { amount: data.balance }) : t('profile.balanceUnknown')
  const balanceLabel = balanceKnown ? t('profile.balance', { amount: data.balance }) : t('profile.balanceUnknown')
  const spentLabel = data.spentUsd != null && data.spentUsd > 0 ? formatCostUsd(data.spentUsd) : null
  const accountDetails = [
    planLabel,
    `${t('profile.balanceLabel')} ${descriptionBalance}`,
    spentLabel ? t('profile.spent', { amount: spentLabel }) : null,
  ].filter(Boolean).join(' · ')
  const avatar = (
    <Avatar className={cn('shrink-0 rounded-full shadow-minimal', compact ? 'size-8' : 'size-9')}>
      {data.avatar ? <AvatarImage src={data.avatar} alt="" /> : null}
      <AvatarFallback
        delayMs={0}
        className="bg-surface-pressed text-text-primary"
      >
        {defaultAvatarFallback ?? <RoxInkAvatarArt />}
      </AvatarFallback>
    </Avatar>
  )

  const openAccountSettings = React.useCallback(() => {
    setOpen(false)
    onClick()
  }, [onClick])

  return (
<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'min-w-0 w-full flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border-subtle',
            'bg-background/35 text-left shadow-minimal',
            'hover:bg-background/65 hover:border-border-strong transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
            compact ? 'flex-col justify-center gap-1 px-1 py-1' : 'gap-2.5 p-2.5',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
          aria-label={t('profile.openMenu', { name: displayName })}
          aria-describedby={detailsId}
          title={`${displayName} · ${accountDetails}`}
          data-tutorial="profile-strip"
          data-compact={compact || undefined}
        >
          <span id={detailsId} className="sr-only">{accountDetails}</span>
          {avatar}
          <span className={cn('min-w-0', compact ? 'w-full text-center' : 'flex-1')}>
            <span
              className={cn(
                'block truncate font-medium',
                compact ? 'text-caption text-text-secondary' : 'text-body text-text-primary',
              )}
              title={displayName}
            >
              {displayName}
            </span>
            {!compact ? <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption leading-4">
              <span className="truncate rounded-md border border-border-subtle bg-surface-hover px-1.5 font-medium text-text-secondary">
                {planLabel}
              </span>
              <span className="truncate text-text-secondary numeric">
                {t('profile.level', { level: data.level })}
              </span>
              <span
                className="min-w-0 truncate text-muted-foreground numeric"
                data-testid="profile-strip-balance"
                title={spentLabel ? t('profile.spentTooltip') : undefined}
              >
                {t('profile.balanceLabel')} {balanceLabel}
              </span>
            </span> : null}
            {!compact && spentLabel ? <span className="mt-0.5 block truncate text-caption text-muted-foreground/70" title={t('profile.spentTooltip')}>{t('profile.spent', { amount: spentLabel })}</span> : null}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-1">
        <UserProfilePopoverContent
          data={data}
          planLabel={planLabel}
          balanceLabel={balanceLabel}
          balanceKnown={balanceKnown}
          spentLabel={spentLabel}
          avatar={avatar}
          onOpenAccountSettings={openAccountSettings}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}