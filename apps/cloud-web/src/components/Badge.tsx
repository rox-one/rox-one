import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  class?: string
  children?: JSX.Element
}

export function Badge(props: BadgeProps): JSX.Element {
  return (
    <span class={cx('badge', props.class)} data-tone={props.tone ?? 'neutral'}>
      <Show when={props.dot === true}>
        <span class="badge-dot" aria-hidden="true" />
      </Show>
      {props.children}
    </span>
  )
}
