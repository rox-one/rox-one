import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export interface EmptyStateProps {
  title: JSX.Element
  description?: JSX.Element
  icon?: IconName
  action?: JSX.Element
  class?: string
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={cx('empty', props.class)}>
      <Show when={props.icon !== undefined}>
        <span class="empty-icon">
          <Icon name={props.icon ?? 'box'} size={18} />
        </span>
      </Show>
      <div class="empty-title">{props.title}</div>
      <Show when={props.description !== undefined}>
        <div class="empty-desc">{props.description}</div>
      </Show>
      <Show when={props.action !== undefined}>
        <div class="empty-action">{props.action}</div>
      </Show>
    </div>
  )
}
