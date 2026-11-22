import { For, splitProps } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[]
  /** An empty first option; omit it when the control always has a value. */
  placeholder?: string
  class?: string
}

export function Select(props: SelectProps): JSX.Element {
  const [local, rest] = splitProps(props, ['options', 'placeholder', 'class'])
  return (
    <select class={cx('select', local.class)} {...rest}>
      {local.placeholder === undefined ? null : <option value="">{local.placeholder}</option>}
      <For each={local.options}>
        {(option) => (
          <option value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        )}
      </For>
    </select>
  )
}
