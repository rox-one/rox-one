/**
 * Sidebar profile strip — identity trigger for the signed-in user.
 *
 * Opens the user profile popover (name, plan, level, balance and account
 * actions). Account switching stays in AccountMenu. Level and XP details also
 * live on the account page. This strip shows name, plan, level, and balance.
 * Balance is shown only when known; unknown stays in the screen-reader description.
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

/** Per-plan tint for the compact plan pill (gradient + inner highlight + soft shadow). */
const PLAN_PILL_TONES: Record<string, string> = {
  standard: 'from-zinc-100 to-zinc-200 text-zinc-700 ring-zinc-300/70 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200 dark:ring-white/10',
  pro: 'from-sky-100 to-indigo-200 text-indigo-800 ring-indigo-300/70 dark:from-sky-500/30 dark:to-indigo-600/40 dark:text-indigo-100 dark:ring-indigo-300/20',
  max: 'from-amber-100 to-orange-200 text-orange-800 ring-orange-300/70 dark:from-amber-400/30 dark:to-orange-600/40 dark:text-amber-100 dark:ring-amber-300/20',
  team: 'from-emerald-100 to-teal-200 text-teal-800 ring-teal-300/70 dark:from-emerald-500/30 dark:to-teal-600/40 dark:text-emerald-100 dark:ring-emerald-300/20',
}

function PlanPill({ plan, label }: { plan: string; label: string }) {
  return (
    <span
      data-testid="profile-strip-plan"
      data-plan={plan}
      className={cn(
        'inline-flex h-4 max-w-full items-center truncate rounded-full bg-gradient-to-b px-1.5 text-mark font-semibold uppercase leading-none tracking-wide',
        'ring-1 ring-inset shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_1px_2px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.4)]',
        PLAN_PILL_TONES[plan] ?? PLAN_PILL_TONES.standard,
      )}
    >
      {label}
    </span>
  )
}

/** Small level medallion with a thin decorative XP ring (progress 0..1). */
function LevelBadge({ level, progress, label }: { level: number; progress: number; label: string }) {
  const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  const r = 8
  const circumference = 2 * Math.PI * r
  const srLabel = `${label} · XP ${Math.round(ratio * 100)}%`
  return (
    <span data-testid="profile-strip-level" className="inline-flex items-center" title={srLabel}>
      <span className="sr-only">{srLabel}</span>
      <span aria-hidden="true" className="relative inline-flex size-5 items-center justify-center">
        <svg viewBox="0 0 20 20" className="absolute inset-0 size-full -rotate-90">
          <circle cx="10" cy="10" r={r} fill="none" strokeWidth="1.75" className="stroke-border-subtle" />
          {ratio > 0 ? <circle cx="10" cy="10" r={r} fill="none" strokeWidth="1.75" strokeLinecap="round"
            className="stroke-status-warning"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} /> : null}
        </svg>
        <span className="relative text-mark font-bold leading-none text-text-primary numeric">{level}</span>
      </span>
    </span>
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
  /** Opens app settings from the popover («Настройки»). */
  onOpenSettings?: () => void
  className?: string
  defaultAvatarFallback?: React.ReactNode
  /** Avatar-only presentation for the collapsed navigation rail. */
  compact?: boolean
}

export function ProfileStrip({
  data,
  onClick,
  onOpenSettings,
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
  const openSettings = React.useMemo(() => onOpenSettings ? () => { setOpen(false); onOpenSettings() } : undefined, [onOpenSettings])

  return (
<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'min-w-0 w-full flex items-center overflow-hidden rounded-none border-0 border-t border-border-subtle',
            // Flush with the sidebar edge: an inner card inside the rounded rail would leave corner voids.
            'bg-transparent text-left',
            'hover:bg-[var(--state-hover)] transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
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
              <PlanPill plan={plan} label={planLabel} />
              <LevelBadge level={data.level} progress={data.progress} label={t('profile.level', { level: data.level })} />
              {balanceKnown ? <span
                className="min-w-0 truncate text-muted-foreground numeric"
                data-testid="profile-strip-balance"
                title={spentLabel ? t('profile.spentTooltip') : undefined}
              >
                {t('profile.balanceLabel')} {balanceLabel}
              </span> : null}
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
          onOpenSettings={openSettings}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}