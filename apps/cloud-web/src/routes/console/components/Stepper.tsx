import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

export interface StepperProps {
  id: string
  label: string
  value: number
  unit: string
  min: number
  max: number
  step?: number
  hint?: JSX.Element
  onChange: (value: number) => void
}

/**
 * A number field with minus and plus buttons. The input stays a real
 * `type="number"`, so a keyboard and a screen reader get the same control the
 * buttons give a pointer; every change is clamped before it leaves the field.
 */
export function Stepper(props: StepperProps): JSX.Element {
  const step = (): number => props.step ?? 1
  const clamp = (value: number): number => Math.min(props.max, Math.max(props.min, value))
  const set = (value: number): void => props.onChange(clamp(value))

  return (
    <div class="stepper">
      <div class="stepper-head">
        <label class="field-label" for={props.id}>
          {props.label}
        </label>
        <span class="stepper-unit">{props.unit}</span>
      </div>
      <div class="stepper-controls">
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Меньше: ${props.label}`}
          disabled={props.value <= props.min}
          onClick={() => set(props.value - step())}
        >
          −
        </button>
        <input
          id={props.id}
          class="input stepper-input"
          type="number"
          inputmode="numeric"
          min={props.min}
          max={props.max}
          step={step()}
          value={props.value}
          aria-describedby={props.hint === undefined ? undefined : `${props.id}-hint`}
          onInput={(event) => {
            const parsed = Number(event.currentTarget.value)
            if (Number.isFinite(parsed)) set(Math.round(parsed))
          }}
          onChange={(event) => {
            const parsed = Number(event.currentTarget.value)
            event.currentTarget.value = String(clamp(Number.isFinite(parsed) ? Math.round(parsed) : props.value))
          }}
        />
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Больше: ${props.label}`}
          disabled={props.value >= props.max}
          onClick={() => set(props.value + step())}
        >
          +
        </button>
      </div>
      <Show when={props.hint !== undefined}>
        <div class="field-hint" id={`${props.id}-hint`}>
          {props.hint}
        </div>
      </Show>
    </div>
  )
}
