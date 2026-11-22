import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { Icon } from './Icon'
import type { IconName } from './Icon'

export type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface StatProps {
  label: JSX.Element
  value: JSX.Element
  hint?: JSX.Element
  tone?: StatTone
  icon?: IconName
}

export function Stat(props: StatProps): JSX.Element {
  return (
    <div class="stat" data-tone={props.tone ?? 'neutral'}>
      <div class="stat-label">
        <Show when={props.icon !== undefined}>
          <Icon name={props.icon ?? 'chart'} size={14} />
        </Show>
        {props.label}
      </div>
      <div class="stat-value">{props.value}</div>
      <Show when={props.hint !== undefined}>
        <div class="stat-hint">{props.hint}</div>
      </Show>
    </div>
  )
}
