import * as React from 'react'
import { useLayoutEffect } from 'react'
import { Circle, Flag, MoreHorizontal } from 'lucide-react'
import { DndContext } from '@dnd-kit/core'
import { EntityList } from '@/components/ui/entity-list'
import { EntityRow } from '@/components/ui/entity-row'
import { useMenuComponents } from '@/components/ui/menu-context'
import { NotesNavigationSidebar } from '@/pages/notes/NotesNavigationSidebar'
import type { DomSessionRow } from './dom-fixtures'

const STATUS_COLOR: Record<DomSessionRow['status'], string> = {
  todo: 'var(--muted-foreground)',
  'in-progress': 'var(--info)',
  'needs-review': 'var(--warning)',
  done: 'var(--success)',
}

/**
 * Fires once the panel subtree has committed AND painted. Two nested rAFs wait
 * for the frame that includes the commit, so the timing covers DOM insertion,
 * style recalc and layout — not just the React render pass.
 *
 * Stable-contract hook: every DOM panel in this harness needs the same
 * commit+paint signal, so the indirection is shared rather than inlined.
 */
export function useAfterFirstPaint(onReady: () => void): void {
  useLayoutEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onReady())
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
    // onReady is a stable callback authored by the harness entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function SessionMenuMock() {
  const { MenuItem, Separator } = useMenuComponents()
  return (
    <>
      <MenuItem onClick={() => {}}>Open</MenuItem>
      <MenuItem onClick={() => {}}>Rename</MenuItem>
      <Separator />
      <MenuItem variant="destructive" onClick={() => {}}>Delete</MenuItem>
    </>
  )
}

function formatRelative(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

function renderSessionRow(
  row: DomSessionRow,
  selectedId: string | null | undefined,
  onSelect?: (id: string) => void,
): React.ReactNode {
  return (
    <EntityRow
      key={row.id}
      icon={
        <Circle
          className="icon-caption"
          style={{ color: STATUS_COLOR[row.status] }}
        />
      }
      title={row.title}
      badges={
        <>
          {row.hasUnread && (
            <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-caption font-medium text-white">
              New
            </span>
          )}
          {row.isFlagged && <Flag className="icon-status shrink-0 text-info" />}
          {row.labels.map((label) => (
            <span
              key={label}
              className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-caption font-medium text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </>
      }
      trailing={
        <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">
          {formatRelative(row.lastMessageAt)}
        </span>
      }
      isSelected={selectedId === row.id}
      onClick={onSelect ? () => onSelect(row.id) : undefined}
      menuContent={<SessionMenuMock />}
      hoverActions={<MoreHorizontal className="icon-toolbar" />}
    />
  )
}

export interface SessionPanelProps {
  rows: DomSessionRow[]
  onReady: () => void
  /**
   * `virtualized` passes the shipped `virtualize` flag to the production
   * `EntityList` (windows rows >= 40). `unvirtualized` mounts every row — the
   * pre-virtualization behaviour, used only for the "before" reference.
   */
  variant?: 'virtualized' | 'unvirtualized'
  selectedId?: string | null
  onSelect?: (id: string) => void
}

/** Session list subtree built from the production `EntityList` + `EntityRow` primitives. */
export function SessionPanel({ rows, onReady, variant = 'virtualized', selectedId, onSelect }: SessionPanelProps) {
  useAfterFirstPaint(onReady)
  return (
    <EntityList
      items={rows}
      virtualize={variant === 'virtualized'}
      getKey={(row) => row.id}
      containerProps={{ 'data-perf-row-container': 'sessions', 'data-perf-variant': variant }}
      renderItem={(row) => renderSessionRow(row, selectedId, onSelect)}
    />
  )
}

export interface NotesPanelProps {
  notes: React.ComponentProps<typeof NotesNavigationSidebar>['notes']
  activeNoteId?: string | null
  onOpenNote?: (id: string) => void
  /**
   * Scroll parent the navigator windows against. Production passes the notes
   * list viewport; the fixture passes its own scroll container so the measured
   * mount takes the same windowed path the app does.
   */
  viewportRef?: React.RefObject<HTMLDivElement | null>
  onReady: () => void
}

const noop = () => {}

/**
 * Notes navigator subtree: the real production `NotesNavigationSidebar`
 * (folder tree + DnD note rows) with a large note fixture.
 */
export function NotesPanel({ notes, activeNoteId, onOpenNote, viewportRef, onReady }: NotesPanelProps) {
  useAfterFirstPaint(onReady)
  const [collapsedFolders] = React.useState<Set<string>>(() => new Set())
  return (
    <DndContext onDragEnd={noop}>
      <NotesNavigationSidebar
        notes={notes}
        activeNoteId={activeNoteId ?? null}
        collapsedFolders={collapsedFolders}
        {...(viewportRef ? { viewportRef } : {})}
        onToggleFolder={noop}
        emptyMessage="No notes"
        onOpenNote={onOpenNote ?? noop}
        onOpenCreateNoteDialog={noop}
        onOpenRenameFolder={noop}
        onOpenDeleteFolder={noop}
        onOpenMoveDialog={noop}
        onOpenRenameDialogForNote={noop}
        onOpenDeleteDialogForNote={noop}
        onDuplicateNote={noop}
        onCopyNoteLink={noop}
        onCopyNotePath={noop}
        onRevealNote={noop}
      />
    </DndContext>
  )
}