/**
 * Sidebar profile strip — compact identity trigger.
 *
 * Opens the personal account page. Account switching stays in AccountMenu.
 * Level and XP live on the account page. Billing details stay available in the
 * accessible description and tooltip while the sidebar keeps one identity row.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
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
}

interface ProfileStripProps {
  data: ProfileStripData
  onClick: () => void
  className?: string
  defaultAvatarFallback?: React.ReactNode
}

export const ProfileStrip = React.forwardRef<HTMLButtonElement, ProfileStripProps>(function ProfileStrip({
  data, onClick, className, defaultAvatarFallback,
}, ref) {
  const { t } = useTranslation()
  const detailsId = React.useId()
  const displayName = data.displayName || t('profile.defaultName')
  const plan = data.plan ?? 'standard'
  const balanceLabel =
    data.balance === null || !Number.isFinite(data.balance)
      ? t('profile.balanceEmpty')
      : t('profile.balance', { amount: data.balance })
  const billingDescription = `${t(`settings.account.plan.${plan}`)} · ${t('profile.balanceLabel')} ${balanceLabel}`
  const avatarFallback = defaultAvatarFallback ?? (
    <img
      src={bundledDefaultAvatar}
      alt=""
      className="h-full w-full object-cover"
    />
  )

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2 py-1.5 [@media(pointer:coarse)]:min-h-11',
        'text-left hover:bg-sidebar-hover transition-colors motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      aria-label={t('profile.openSettings', { name: displayName })}
      aria-describedby={detailsId}
      title={`${displayName} · ${billingDescription}`}
      data-tutorial="profile-strip"
    >
      <Avatar className="h-6 w-6 shrink-0">
        {data.avatar ? <AvatarImage src={data.avatar} alt="" /> : null}
        <AvatarFallback
          delayMs={0}
          className="bg-foreground/10 text-foreground/80"
        >
          {avatarFallback}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">
        {displayName}
      </span>
      <span id={detailsId} className="sr-only">{billingDescription}</span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
})
