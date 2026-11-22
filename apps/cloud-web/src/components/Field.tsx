import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface FieldProps {
  /** Visible text; without it pass `aria-label` to the control itself. */
  label?: JSX.Element
  /** The control's `id`, so clicking the label focuses the control. */
  for?: string
  hint?: JSX.Element
  error?: JSX.Element | null
  required?: boolean
  class?: string
  children: JSX.Element
}

/**
 * Label, hint and error around one control. The page keeps the control itself,
 * so a complex field (a slider pair, a custom select) still gets an accessible
 * label and one place for its error text.
 */
export function Field(props: FieldProps): JSX.Element {
  const hasError = (): boolean => props.error !== undefined && props.error !== null && props.error !== ''
  return (
    <div class={cx('field', props.class)}>
      <Show when={props.label !== undefined}>
        <label class="field-label" for={props.for}>
          {props.label}
          <Show when={props.required === true}>
            <span class="field-required" aria-hidden="true">
              *
            </span>
          </Show>
        </label>
      </Show>
      {props.children}
      <Show when={props.hint !== undefined && !hasError()}>
        <div class="field-hint">{props.hint}</div>
      </Show>
      <Show when={hasError()}>
        <div class="field-error" role="alert">
          {props.error}
        </div>
      </Show>
    </div>
  )
}
