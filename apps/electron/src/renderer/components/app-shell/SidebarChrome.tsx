import * as React from 'react'
import { Brain, Bell, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProfileStrip, type ProfileStripData } from './ProfileStrip'
import { PromoSlot } from './PromoSlot'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed } from './sidebar-guidance'
import type { PromoKind } from '@/platform/promo-slot'

interface SidebarChromeProps {
  workspaceId?: string | null
  profile: ProfileStripData
  onProfileClick: () => void
  promoKind: PromoKind | null
  reminderDueCount?: number
  onPromoCta: () => void
}

export function SidebarChrome({
  workspaceId,
  profile,
  onProfileClick,
  promoKind,
  reminderDueCount,
  onPromoCta,
}: SidebarChromeProps) {
  const profileRef = React.useRef<HTMLButtonElement>(null)
  return (
    <div className="shrink-0 border-t border-border/40 px-1.5 py-1">
      {promoKind ? (
        <SidebarGuidance
          key={workspaceId || '_default'}
          workspaceId={workspaceId}
          kind={promoKind}
          reminderDueCount={reminderDueCount}
          onCta={onPromoCta}
          onDismiss={() => profileRef.current?.focus()}
        />
      ) : null}
      <ProfileStrip ref={profileRef} data={profile} onClick={onProfileClick} />
    </div>
  )
}

function SidebarGuidance({ workspaceId, kind, reminderDueCount, onCta, onDismiss }: {
  workspaceId?: string | null
  kind: PromoKind
  reminderDueCount?: number
  onCta: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = React.useState(() => isSidebarGuidanceDismissed(workspaceId))
  const [open, setOpen] = React.useState(false)
  const leavesTrigger = React.useRef(false)
  const title = t(kind === 'onboarding' ? 'promo.onboardingTitle' : 'promo.reminderTitle')
  const Icon = kind === 'onboarding' ? Brain : Bell

  if (kind === 'onboarding' && dismissed) return null

  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) leavesTrigger.current = false
      setOpen(next)
    }}>
      <div className="flex min-w-0 items-center gap-0.5">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
            title={title}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {kind === 'reminder' && reminderDueCount != null && reminderDueCount > 0 ? (
              <span className="shrink-0 tabular-nums">{reminderDueCount}</span>
            ) : null}
            <ChevronRight className="size-3 shrink-0" aria-hidden />
          </button>
        </PopoverTrigger>
        {kind === 'onboarding' ? (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [@media(pointer:coarse)]:size-11"
            aria-label={t('sidebar.guidance.dismiss')}
            title={t('sidebar.guidance.dismiss')}
            onClick={() => {
              leavesTrigger.current = true
              dismissSidebarGuidance(workspaceId)
              setDismissed(true)
              setOpen(false)
              onDismiss()
            }}
          >
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-0 [&>[data-promo-slot]]:rounded-none [&>[data-promo-slot]]:border-0 [&>[data-promo-slot]]:bg-transparent [&>[data-promo-slot]]:p-3 [&>[data-promo-slot]]:shadow-none"
        aria-label={title}
        onCloseAutoFocus={(event) => {
          if (leavesTrigger.current) event.preventDefault()
        }}
      >
        <PromoSlot kind={kind} reminderDueCount={reminderDueCount} onCta={() => {
          leavesTrigger.current = true
          setOpen(false)
          onCta()
        }} />
      </PopoverContent>
    </Popover>
  )
}
