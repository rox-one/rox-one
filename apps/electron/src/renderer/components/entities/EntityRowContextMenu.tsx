/**
 * W1-08 (#1505) — right-click menu shared by entity chips and rows.
 *
 * Built-ins: Open, Open in new tab, Copy link. Then the common hook
 * `getEntityRowActions(ref)`; its defaults are shown disabled until a
 * handler is registered.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { entityDeepLink, type EntityRef } from '@rox/core/entities'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { getEntityRowActions, subscribeEntityRowActions } from './row-actions'
import { openEntity } from './open-entity'

export function useEntityRowActions(ref: EntityRef | null) {
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => subscribeEntityRowActions(bump), [])
  return ref ? getEntityRowActions(ref) : []
}

export interface EntityRowContextMenuProps {
  entityRef: EntityRef
  children: React.ReactElement
  onOpen?: (ref: EntityRef, options: { newPanel?: boolean }) => void
}

export function EntityRowContextMenu({ entityRef, children, onOpen }: EntityRowContextMenuProps) {
  const { t } = useTranslation()
  const actions = useEntityRowActions(entityRef)
  const open = onOpen ?? ((ref: EntityRef, options: { newPanel?: boolean }) => { openEntity(ref, options) })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onSelect={() => open(entityRef, {})}>{t('entities.ui.rowActions.open')}</StyledContextMenuItem>
        <StyledContextMenuItem onSelect={() => open(entityRef, { newPanel: true })}>{t('entities.ui.rowActions.openNewTab')}</StyledContextMenuItem>
        <StyledContextMenuItem
          onSelect={() => { try { void navigator.clipboard?.writeText(entityDeepLink(entityRef)) } catch { /* unavailable */ } }}
        >
          {t('entities.ui.rowActions.copyLink')}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        {actions.map((action) => (
          <StyledContextMenuItem
            key={action.id}
            disabled={action.disabled}
            data-entity-row-action={action.id}
            title={action.disabled ? t('entities.ui.rowActions.unavailable') : undefined}
            onSelect={() => { if (!action.disabled) void action.run() }}
          >
            {t(action.labelKey)}
          </StyledContextMenuItem>
        ))}
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
