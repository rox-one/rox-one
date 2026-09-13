import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { selectGroupDisabled } from '@/components/ui/entity-list'
import { cn } from '@/lib/utils'

export interface SessionTableGroupHeaderProps {
  bucket: { key: string; label: string; count: number }
  collapsed: boolean
  onToggle: () => void
  onSelectGroup?: () => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
  style?: React.CSSProperties
}

export function SessionTableGroupHeader({
  bucket,
  collapsed,
  onToggle,
  onSelectGroup,
  onCollapseAll,
  onExpandAll,
  style,
}: SessionTableGroupHeaderProps) {
  const { t } = useTranslation()
  const collapsible = bucket.count > 0

  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            'sticky top-[29px] z-[5] flex min-h-8 items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground/80 backdrop-blur',
          )}
          style={style}
        >
          {collapsible ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
              onClick={onToggle}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{bucket.label}</span>
              <span className="font-normal text-muted-foreground">({bucket.count})</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span>{bucket.label}</span>
              <span className="font-normal text-muted-foreground">({bucket.count})</span>
            </span>
          )}
        </li>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        {collapsible ? (
          <StyledContextMenuItem onClick={onToggle}>
            {collapsed ? t('entityList.expand') : t('entityList.collapse')}
          </StyledContextMenuItem>
        ) : null}
        {onSelectGroup ? (
          <StyledContextMenuItem disabled={selectGroupDisabled(bucket.count)} onClick={onSelectGroup}>
            {t('entityList.selectGroup')}
          </StyledContextMenuItem>
        ) : null}
        <StyledContextMenuSeparator />
        {onCollapseAll ? (
          <StyledContextMenuItem onClick={onCollapseAll}>{t('entityList.collapseAll')}</StyledContextMenuItem>
        ) : null}
        {onExpandAll ? (
          <StyledContextMenuItem onClick={onExpandAll}>{t('entityList.expandAll')}</StyledContextMenuItem>
        ) : null}
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

export function SessionTableEmptyDropLane({
  bucketKey,
  active,
  onDragOver,
  style,
}: {
  bucketKey: string
  active: boolean
  onDragOver: (groupKey: string, event: React.DragEvent) => void
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center px-3" style={style}>
      <div
        data-empty-group={bucketKey}
        className={cn(
          'w-full rounded-[6px] border border-dashed px-3 py-2 text-[11px] text-muted-foreground/70',
          active ? 'border-foreground/40 bg-foreground/5 text-foreground/80' : 'border-foreground/15',
        )}
        onDragOver={(event) => onDragOver(bucketKey, event)}
      >
        {t('entityList.emptyGroupDrop')}
      </div>
    </li>
  )
}
