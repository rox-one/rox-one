/**
 * Sidebar profile strip — compact identity trigger.
 *
 * Opens the personal account page. Account switching stays in AccountMenu.
 * Level and XP also live on the account page. This strip shows name, plan, and balance.
 * It is the only place the balance and the workspace spend are shown (the
 * titlebar and status bar no longer carry cost/usage chips).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatCostUsd } from './input/turn-progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { ProfilePlan } from '../../../shared/types'

const bundledDefaultAvatar = new URL(
  '../../../../resources/default-avatar.svg',
  import.meta.url,
).href

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
  const displayName = data.displayName.trim() || t('profile.defaultName')
  const plan = data.plan ?? 'standard'
  const planLabel = t(`settings.account.plan.${plan}`)
  const balanceLabel =
    data.balance === null || !Number.isFinite(data.balance)
      ? t('profile.balanceEmpty')
      : t('profile.balance', { amount: data.balance })
  const spentLabel = data.spentUsd != null && data.spentUsd > 0 ? formatCostUsd(data.spentUsd) : null
  const accountDetails = [
    planLabel,
    `${t('profile.balanceLabel')} ${balanceLabel}`,
    spentLabel ? t('profile.spent', { amount: spentLabel }) : null,
  ].filter(Boolean).join(' · ')
  const avatarFallback = defaultAvatarFallback ?? (
    <img
      src={bundledDefaultAvatar}
      alt=""
      className="h-full w-full object-cover"
    />
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group min-w-0 w-full flex items-center overflow-hidden rounded-[var(--radius-control)] border border-foreground/5',
        'bg-background/35 text-left shadow-minimal backdrop-blur-xl',
        'hover:bg-background/65 hover:border-foreground/10 transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
        compact ? 'justify-center p-0.5' : 'gap-2.5 p-2.5',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      aria-label={t('profile.openSettings', { name: displayName })}
      aria-describedby={detailsId}
      title={`${displayName} · ${accountDetails}`}
      data-tutorial="profile-strip"
      data-compact={compact || undefined}
    >
      <span id={detailsId} className="sr-only">{accountDetails}</span>
      <Avatar className={cn('shrink-0 rounded-full ring-1 ring-foreground/10', compact ? 'size-8' : 'size-9')}>
        {data.avatar ? <AvatarImage src={data.avatar} alt="" /> : null}
        <AvatarFallback
          delayMs={0}
          className="bg-foreground/10 text-foreground/80"
        >
          {avatarFallback}
        </AvatarFallback>
      </Avatar>
      {!compact ? <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground/90">
          {displayName}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4">
          <span className="truncate rounded-md border border-foreground/5 bg-foreground/5 px-1.5 font-medium text-foreground/70">
            {planLabel}
          </span>
          <span
            className="min-w-0 truncate text-muted-foreground tabular-nums"
            data-testid="profile-strip-balance"
            title={spentLabel ? t('profile.spentTooltip') : undefined}
          >
            {t('profile.balanceLabel')} {balanceLabel}
          </span>
        </span>
        {spentLabel ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70" title={t('profile.spentTooltip')}>{t('profile.spent', { amount: spentLabel })}</span> : null}
      </span> : null}
    </button>
  )
}
