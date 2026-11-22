import { For } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface SkeletonProps {
  /** How many placeholder lines; three is the default for a card body. */
  lines?: number
  class?: string
}

export function Skeleton(props: SkeletonProps): JSX.Element {
  const count = (): number => Math.max(1, props.lines ?? 3)
  return (
    <div class={cx('skeleton', props.class)} aria-hidden="true">
      <For each={Array.from({ length: count() }, (_, index) => index)}>
        {() => <div class="skeleton-line" />}
      </For>
    </div>
  )
}
