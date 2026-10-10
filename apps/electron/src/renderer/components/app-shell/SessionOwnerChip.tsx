/**
 * SessionOwnerChip — compact owner indicator for the sidebar row and the chat
 * header (a2.1). Presentational only: `owner === undefined/null` renders the
 * honest "unassigned" state; an assigned owner renders initials + name so the
 * collaboration plane is visible at a glance.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionOwnerRef } from '@rox/shared/protocol'

export interface SessionOwnerChipProps {
  owner?: SessionOwnerRef | null
  size?: 'sm' | 'md'
  className?: string
  /** Invoked when the chip is clickable (e.g. opens the owner submenu). */
  onClick?: () => void
}

function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?'
}

export function SessionOwnerChip({ owner, size = 'md', className, onClick }: SessionOwnerChipProps) {
  const { t } = useTranslation()
  const dimension = size === 'sm' ? 'h-4 w-4 text-xs' : 'h-5 w-5 text-xs'

  const body = owner ? (
    <span
      data-owner-state="owned"
      title={t('sessionOwner.ownedBy', { name: owner.displayName })}
      className={cn(
        'inline-flex max-w-[120px] items-center gap-1 rounded-full bg-accent/10 pl-0.5 pr-1.5 py-0.5 text-caption text-foreground ring-1 ring-accent/20',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent/20 font-medium text-foreground', dimension)}
      >
        {ownerInitials(owner.displayName)}
      </span>
      <span className="truncate" title={owner.displayName}>{owner.displayName}</span>
    </span>
  ) : (
    <span
      data-owner-state="unassigned"
      title={t('sessionOwner.unassigned')}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-1.5 py-0.5 text-caption text-muted-foreground',
        className,
      )}
    >
      <UserRound className={size === 'sm' ? 'icon-status' : 'icon-caption'} aria-hidden="true" />
      <span className="truncate">{t('sessionOwner.unassigned')}</span>
    </span>
  )

  if (!onClick) return body
  return (
    <button type="button" onClick={onClick} className="appearance-none border-0 bg-transparent p-0">
      {body}
    </button>
  )
}