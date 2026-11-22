import { For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'

export interface TableColumn<T> {
  key: string
  label: string
  /** Custom cell content; without it the row field named by `key` is printed. */
  render?: (row: T, index: number) => JSX.Element
  align?: 'left' | 'right'
  class?: string
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[]
  rows: readonly T[]
  rowKey?: (row: T, index: number) => string
  empty?: JSX.Element
  /** Accessible name of the table. */
  label?: string
  loading?: boolean
  onRowClick?: (row: T) => void
  class?: string
}

function cellText(row: unknown, key: string): string {
  if (row === null || (typeof row !== 'object' && typeof row !== 'function')) return '—'
  const value = Reflect.get(row, key)
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * A table that becomes a stack of labelled cards under 760 px: the same markup,
 * so a page never keeps a second mobile copy. `data-label` is the card caption.
 */
export function Table<T>(props: TableProps<T>): JSX.Element {
  return (
    <div class={cx('table-wrap', props.class)}>
      <Show
        when={props.loading === true && props.rows.length === 0}
        fallback={
          <table class="table" aria-label={props.label}>
            <thead>
              <tr>
                <For each={props.columns}>
                  {(column) => (
                    <th scope="col" class={cx(column.align === 'right' && 'num', column.class)}>
                      {column.label}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <Show
                when={props.rows.length > 0}
                fallback={
                  <tr class="table-empty-row">
                    <td colSpan={props.columns.length}>
                      {props.empty ?? (
                        <EmptyState title="Пусто" description="Здесь пока нет строк." />
                      )}
                    </td>
                  </tr>
                }
              >
                <For each={props.rows}>
                  {(row, index) => (
                    <tr
                      class={cx(props.onRowClick !== undefined && 'table-row-clickable')}
                      tabIndex={props.onRowClick === undefined ? undefined : 0}
                      onClick={() => props.onRowClick?.(row)}
                      onKeyDown={(event) => {
                        if (props.onRowClick === undefined) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          props.onRowClick(row)
                        }
                      }}
                    >
                      <For each={props.columns}>
                        {(column) => (
                          <td
                            data-label={column.label}
                            class={cx(column.align === 'right' && 'num', column.class)}
                          >
                            {column.render === undefined ? cellText(row, column.key) : column.render(row, index())}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        }
      >
        <div class="table-loading">
          <Skeleton lines={4} />
        </div>
      </Show>
    </div>
  )
}
