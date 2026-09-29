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
}

export function ProfileStrip({
  data,
  onClick,
  className,
  defaultAvatarFallback,
}: ProfileStripProps) {
  const { t } = useTranslation()
  const displayName = data.displayName || t('profile.defaultName')
  const plan = data.plan ?? 'standard'
  const balanceLabel =
    data.balance === null || !Number.isFinite(data.balance)
      ? t('profile.balanceEmpty')
      : t('profile.balance', { amount: data.balance })
  const spentLabel = data.spentUsd != null && data.spentUsd > 0 ? formatCostUsd(data.spentUsd) : null
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
        'w-full flex items-center gap-2 px-2 py-2 rounded-[8px]',
        'text-left hover:bg-foreground/5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      aria-label={t('profile.openSettings', { name: displayName })}
      data-tutorial="profile-strip"
    >
      <Avatar className="h-8 w-8 shrink-0">
        {data.avatar ? <AvatarImage src={data.avatar} alt="" /> : null}
        <AvatarFallback
          delayMs={0}
          className="bg-foreground/10 text-foreground/80"
        >
          {avatarFallback}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground/90">
          {displayName}
        </span>
        <span
          className="block truncate text-[11px] text-muted-foreground"
          data-testid="profile-strip-balance"
          title={spentLabel ? t('profile.spentTooltip') : undefined}
        >
          {t(`settings.account.plan.${plan}`)} · {t('profile.balanceLabel')} {balanceLabel}
          {spentLabel ? <> · {t('profile.spent', { amount: spentLabel })}</> : null}
        </span>
      </span>
    </button>
  )
}
