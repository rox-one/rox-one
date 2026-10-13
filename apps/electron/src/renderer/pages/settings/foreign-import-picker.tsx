import * as React from 'react'
import { VirtualList } from '@/components/ui/virtual-list'

export interface ForeignImportPickerRow {
  sourcePath: string
  kind: string
  title?: string
  userTurns: number
  skipReason?: string
}

export const FOREIGN_IMPORT_ROW_HEIGHT = 56

export function ForeignImportPickerList({
  rows,
  selected,
  onToggle,
  viewportRef,
}: {
  rows: readonly ForeignImportPickerRow[]
  selected: Record<string, boolean>
  onToggle: (sourcePath: string, checked: boolean) => void
  viewportRef: React.RefObject<HTMLElement | null>
}) {
  return (
    <VirtualList<ForeignImportPickerRow>
      items={rows}
      getKey={(row) => row.sourcePath}
      estimateRowHeight={FOREIGN_IMPORT_ROW_HEIGHT}
      overscan={2}
      viewportRef={viewportRef}
      renderItem={(entry) => (
        <label className="flex items-start gap-2 px-3 py-2 text-sm" role="option" data-testid={`import-row-${entry.sourcePath}`}>
          <input
            type="checkbox"
            disabled={Boolean(entry.skipReason)}
            checked={Boolean(selected[entry.sourcePath])}
            onChange={(ev) => onToggle(entry.sourcePath, ev.target.checked)}
          />
          <span>
            <span className="font-medium">{entry.title ?? entry.sourcePath}</span>
            <span className="block text-xs opacity-60">
              {entry.kind} · {entry.userTurns}
              {entry.skipReason ? ` · ${entry.skipReason}` : ''}
            </span>
          </span>
        </label>
      )}
    />
  )
}
