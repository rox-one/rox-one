import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: JSX.Element
  hint?: JSX.Element
  disabled?: boolean
  id?: string
  name?: string
  class?: string
}

/** A checkbox drawn as a switch; the native input keeps keyboard and form semantics. */
export function Switch(props: SwitchProps): JSX.Element {
  return (
    <label class={cx('switch', props.class)}>
      <input
        type="checkbox"
        role="switch"
        id={props.id}
        name={props.name}
        checked={props.checked}
        disabled={props.disabled === true}
        aria-checked={props.checked ? 'true' : 'false'}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span class="switch-track" aria-hidden="true">
        <span class="switch-thumb" />
      </span>
      <Show when={props.label !== undefined || props.hint !== undefined}>
        <span class="switch-text">
          <Show when={props.label !== undefined}>
            <span>{props.label}</span>
          </Show>
          <Show when={props.hint !== undefined}>
            <span class="switch-hint">{props.hint}</span>
          </Show>
        </span>
      </Show>
    </label>
  )
}
