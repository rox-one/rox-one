import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, Globe, Copy, RefreshCw, Link2Off, UserRound, Eye } from 'lucide-react'
import type { MenuComponents } from '@/components/ui/menu-context'
import type { SessionActorRef, SessionOwnerRef, SessionVisibility } from '@rox/shared/protocol'
import { getStatusIconStyle, resolveStatusDisplayLabel, resolveLabelDisplayName, type SessionStatusId, type SessionStatus } from '@/config/session-status-config'
import { sortLabelsForDisplay, type LabelConfig } from '@rox/shared/labels'
import { LabelIcon } from '@/components/ui/label-icon'

export interface ShareMenuItemsProps {
  /** Open the published share URL in the system browser. */
  onOpenInBrowser: () => void
  /** Copy the published share URL to the clipboard. */
  onCopyLink: () => void | Promise<void>
  /** Re-publish the share (bumps the snapshot). */
  onUpdateShare: () => void | Promise<void>
  /** Revoke the share. */
  onRevokeShare: () => void | Promise<void>
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator'>
}

/**
 * Render-only — side effects come from `useSessionMenuActions`. Both the
 * desktop dropdown and the compact drawer wire the same hook callbacks
 * through this component (compact uses its own row primitives, but the
 * action set is identical).
 */
export function ShareMenuItems({
  onOpenInBrowser,
  onCopyLink,
  onUpdateShare,
  onRevokeShare,
  menu,
}: ShareMenuItemsProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = menu

  return (
    <>
      <MenuItem onClick={onOpenInBrowser}>
        <Globe className="icon-caption" />
        <span className="flex-1">{t("sessionMenu.openInBrowser")}</span>
      </MenuItem>
      <MenuItem onClick={onCopyLink}>
        <Copy className="icon-caption" />
        <span className="flex-1">{t("sessionMenu.copyLink")}</span>
      </MenuItem>
      <MenuItem onClick={onUpdateShare}>
        <RefreshCw className="icon-caption" />
        <span className="flex-1">{t("sessionMenu.updateShare")}</span>
      </MenuItem>
      <Separator />
      <MenuItem onClick={onRevokeShare} variant="destructive">
        <Link2Off className="icon-caption" />
        <span className="flex-1">{t("sessionMenu.stopSharing")}</span>
      </MenuItem>
    </>
  )
}

export interface StatusMenuItemsProps {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (stateId: SessionStatusId) => void
  menu: Pick<MenuComponents, 'MenuItem'>
}

export interface OwnerMenuSectionProps {
  /** Current owner (null/undefined = unassigned). */
  owner?: SessionOwnerRef | null
  /** Assignable candidates (participants + creator + owner), deduped by the caller. */
  candidates: readonly SessionActorRef[]
  /** Local viewer's account id, for the "assign to me" shortcut. */
  viewerId: string | null
  /** Whether the viewer is already the owner (hides "assign to me"). */
  isAssignedToViewer: boolean
  onAssign: (owner: SessionActorRef | null) => void
  onAssignToMe: () => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'>
}

/** Assign-owner submenu (a2.2) shared by the desktop dropdown and compact drawer. */
export function OwnerMenuSection({
  owner,
  candidates,
  viewerId,
  isAssignedToViewer,
  onAssign,
  onAssignToMe,
  menu,
}: OwnerMenuSectionProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = menu
  const ownerId = owner?.id ?? null

  return (
    <Sub>
      <SubTrigger className="pr-2">
        <UserRound className="icon-caption" />
        <span className="flex-1">{t('sessionOwner.assign')}</span>
        {owner && <span className="max-w-[100px] truncate text-caption text-muted-foreground -mr-2.5">{owner.displayName}</span>}
      </SubTrigger>
      <SubContent>
        {!isAssignedToViewer && viewerId && (
          <MenuItem onClick={onAssignToMe}>
            <UserRound className="icon-caption" />
            <span className="flex-1">{t('sessionOwner.assignToMe')}</span>
          </MenuItem>
        )}
        {owner && (
          <MenuItem onClick={() => onAssign(null)}>
            <UserRound className="icon-caption" />
            <span className="flex-1">{t('sessionOwner.unassigned')}</span>
          </MenuItem>
        )}
        {candidates.length > 0 && <Separator />}
        {candidates.map((candidate) => (
          <MenuItem key={`${candidate.kind}:${candidate.id}`} onClick={() => onAssign(candidate)}>
            <span className="w-3.5 shrink-0">
              {ownerId === candidate.id && <Check className="icon-caption text-foreground" />}
            </span>
            <span className="flex-1 truncate" title={candidate.displayName}>{candidate.displayName}</span>
          </MenuItem>
        ))}
      </SubContent>
    </Sub>
  )
}

export interface VisibilityMenuSectionProps {
  visibility: SessionVisibility
  onSelect: (visibility: SessionVisibility) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'>
}

const VISIBILITY_OPTIONS: readonly SessionVisibility[] = ['shared', 'read-only', 'suggest', 'draft']

const VISIBILITY_KEY: Record<SessionVisibility, string> = {
  shared: 'shared',
  'read-only': 'readOnly',
  suggest: 'suggest',
  draft: 'draft',
}

/** Sharing visibility submenu (a2.5): shared | read-only | suggest | draft. */
export function VisibilityMenuSection({ visibility, onSelect, menu }: VisibilityMenuSectionProps) {
  const { t } = useTranslation()
  const { MenuItem, Sub, SubTrigger, SubContent } = menu

  return (
    <Sub>
      <SubTrigger className="pr-2">
        <Eye className="icon-caption" />
        <span className="flex-1">{t('sessionSharing.visibilityLabel')}</span>
        <span className="text-caption text-muted-foreground -mr-2.5">{t(`sessionSharing.visibility.${VISIBILITY_KEY[visibility]}`)}</span>
      </SubTrigger>
      <SubContent>
        {VISIBILITY_OPTIONS.map((option) => (
          <MenuItem key={option} onClick={() => onSelect(option)}>
            <span className="w-3.5 shrink-0">
              {visibility === option && <Check className="icon-caption text-foreground" />}
            </span>
            <span className="flex-1">{t(`sessionSharing.visibility.${VISIBILITY_KEY[option]}`)}</span>
          </MenuItem>
        ))}
      </SubContent>
    </Sub>
  )
}

export function StatusMenuItems({
  sessionStatuses,
  activeStateId,
  onSelect,
  menu,
}: StatusMenuItemsProps) {
  const { t } = useTranslation()
  const { MenuItem } = menu

  return (
    <>
      {sessionStatuses.map((state) => {
        const bareIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <MenuItem
            key={state.id}
            onClick={() => onSelect(state.id)}
            className={activeStateId === state.id ? 'bg-foreground/5' : ''}
          >
            <span style={getStatusIconStyle(state)}>
              {bareIcon}
            </span>
            <span className="flex-1">{resolveStatusDisplayLabel(state, t)}</span>
          </MenuItem>
        )
      })}
    </>
  )
}

export interface LabelMenuItemsProps {
  labels: LabelConfig[]
  appliedLabelIds: Set<string>
  onToggle: (labelId: string) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'>
}

/**
 * Count how many labels in a subtree (including the root) are currently applied.
 * Used to show selection counts on parent SubTriggers so users can see
 * where in the tree their selections are.
 */
function countAppliedInSubtree(label: LabelConfig, appliedIds: Set<string>): number {
  let count = appliedIds.has(label.id) ? 1 : 0
  if (label.children) {
    for (const child of label.children) {
      count += countAppliedInSubtree(child, appliedIds)
    }
  }
  return count
}

/**
 * LabelMenuItems - Recursive component for rendering label tree as nested sub-menus.
 *
 * Labels with children render as nested Sub/SubTrigger/SubContent menus (the parent
 * itself appears as the first toggleable item inside its submenu, followed by children).
 * Leaf labels render as simple toggleable menu items with checkmarks.
 * Parent triggers show a count of applied descendants so users can see where selections are.
 */
export function LabelMenuItems({
  labels,
  appliedLabelIds,
  onToggle,
  menu,
}: LabelMenuItemsProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = menu
  const displayLabels = React.useMemo(() => sortLabelsForDisplay(labels), [labels])

  const renderItems = (nodes: LabelConfig[]): React.ReactNode => (
    <>
      {nodes.map(label => {
        const hasChildren = label.children && label.children.length > 0
        const isApplied = appliedLabelIds.has(label.id)

        if (hasChildren) {
          const subtreeCount = countAppliedInSubtree(label, appliedLabelIds)

          return (
            <Sub key={label.id}>
              <SubTrigger className="pr-2">
                <LabelIcon label={label} size="sm" hasChildren />
                <span className="flex-1">{resolveLabelDisplayName(label, t)}</span>
                {subtreeCount > 0 && (
                  <span className="text-caption text-foreground/50 numeric -mr-2.5">
                    {subtreeCount}
                  </span>
                )}
              </SubTrigger>
              <SubContent>
                <MenuItem
                  onSelect={(e: Event) => {
                    e.preventDefault()
                    onToggle(label.id)
                  }}
                >
                  <LabelIcon label={label} size="sm" hasChildren />
                  <span className="flex-1">{resolveLabelDisplayName(label, t)}</span>
                  <span className="w-3.5 ml-4">
                    {isApplied && <Check className="icon-caption text-foreground" />}
                  </span>
                </MenuItem>
                <Separator />
                {renderItems(label.children!)}
              </SubContent>
            </Sub>
          )
        }

        return (
          <MenuItem
            key={label.id}
            onSelect={(e: Event) => {
              e.preventDefault()
              onToggle(label.id)
            }}
          >
            <LabelIcon label={label} size="sm" />
            <span className="flex-1">{resolveLabelDisplayName(label, t)}</span>
            <span className="w-3.5 ml-4">
              {isApplied && <Check className="icon-caption text-foreground" />}
            </span>
          </MenuItem>
        )
      })}
    </>
  )

  return renderItems(displayLabels)
}
