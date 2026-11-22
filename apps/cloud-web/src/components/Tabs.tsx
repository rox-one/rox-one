import { For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface TabItem {
  id: string
  label: JSX.Element
  count?: number
}

export interface TabsProps {
  items: readonly TabItem[]
  active: string
  onChange: (id: string) => void
  /** Names the tab strip for screen readers. */
  label: string
  class?: string
}

export function Tabs(props: TabsProps): JSX.Element {
  const move = (delta: number): void => {
    const index = props.items.findIndex((item) => item.id === props.active)
    if (index < 0) return
    const next = props.items[(index + delta + props.items.length) % props.items.length]
    if (next !== undefined) props.onChange(next.id)
  }

  return (
    <div class={cx('tabs', props.class)} role="tablist" aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            class="tab"
            aria-selected={item.id === props.active ? 'true' : 'false'}
            tabIndex={item.id === props.active ? 0 : -1}
            onClick={() => props.onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                move(1)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                move(-1)
              }
            }}
          >
            {item.label}
            <Show when={item.count !== undefined}>
              <span class="tab-count">{item.count}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}
