import { animate, press } from 'motion'
import type { AnimationPlaybackControlsWithThen } from 'motion'
import { Show, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { prefersReducedMotion } from '@/lib/motion'

/** A held button steps at once, then waits, then keeps ticking. */
const HOLD_MS = 400
const REPEAT_MS = 80
const SCALE_SECONDS = 0.09
const SETTLE_SECONDS = 0.12
const PULSE_SECONDS = 0.07
const SHAKE_SECONDS = 0.26
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]
const PRESSED_SCALE = 0.88
const HOLD_HINT = 'Удерживайте, чтобы число менялось быстрее'

/**
 * One transform run per node. A newer run cancels the older one, and only the
 * newest run may clear the inline transform it left behind.
 */
const motions = new WeakMap<HTMLElement, { stop: () => void }>()
const motionRuns = new WeakMap<HTMLElement, number>()

function runMotion(
  element: HTMLElement,
  start: () => AnimationPlaybackControlsWithThen,
  clear: boolean,
): void {
  motions.get(element)?.stop()
  motions.delete(element)
  const run = (motionRuns.get(element) ?? 0) + 1
  motionRuns.set(element, run)
  if (prefersReducedMotion()) {
    element.style.transform = ''
    return
  }
  const controls = start()
  motions.set(element, controls)
  void controls.then(() => {
    if (motionRuns.get(element) !== run) return
    motions.delete(element)
    if (clear) element.style.transform = ''
  })
}

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
 *
 * A pointer that stays down steps once immediately and keeps stepping after a
 * short wait, so a large jump takes one gesture. A keyboard activates the same
 * button through its real click, which steps exactly once.
 */
export function Stepper(props: StepperProps): JSX.Element {
  const step = (): number => props.step ?? 1
  const clamp = (value: number): number => Math.min(props.max, Math.max(props.min, value))

  let minusButton: HTMLButtonElement | undefined
  let plusButton: HTMLButtonElement | undefined
  let inputElement: HTMLInputElement | undefined
  let holdTimer: number | undefined
  let repeatTimer: number | undefined

  const stopHold = (): void => {
    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer)
      holdTimer = undefined
    }
    if (repeatTimer !== undefined) {
      window.clearInterval(repeatTimer)
      repeatTimer = undefined
    }
  }

  const settle = (button: HTMLElement): void => {
    runMotion(
      button,
      () => animate(button, { scale: 1 }, { duration: SETTLE_SECONDS, ease: EASE }),
      true,
    )
  }

  const shakeInput = (): void => {
    const input = inputElement
    if (input === undefined) return
    runMotion(
      input,
      () =>
        animate(input, { x: [0, -4, 4, -3, 3, 0] }, { duration: SHAKE_SECONDS, ease: EASE }),
      true,
    )
  }

  /** One step towards a bound; at the bound the number shakes and stays put. */
  const stepBy = (direction: 1 | -1): boolean => {
    const atBound = direction > 0 ? props.value >= props.max : props.value <= props.min
    if (atBound) {
      shakeInput()
      return false
    }
    const next = clamp(props.value + direction * step())
    if (next === props.value) {
      shakeInput()
      return false
    }
    props.onChange(next)
    return true
  }

  const pulse = (button: HTMLElement): void => {
    runMotion(
      button,
      () =>
        animate(
          button,
          { scale: [PRESSED_SCALE, PRESSED_SCALE - 0.08, PRESSED_SCALE] },
          { duration: PULSE_SECONDS, ease: EASE },
        ),
      false,
    )
  }

  /**
   * Motion turns Enter into a synthetic pointer press; a keyboard activation
   * also produces its own native click, so the gesture steps only for a real
   * pointer and the click handler below owns the keyboard.
   */
  const hold =
    (direction: 1 | -1) =>
    (element: Element, event: PointerEvent): (() => void) | undefined => {
      if (event.pointerType === '' || !(element instanceof HTMLElement)) return
      if (element instanceof HTMLButtonElement && element.disabled) return
      stopHold()
      if (!stepBy(direction)) return () => settle(element)
      runMotion(
        element,
        () => animate(element, { scale: PRESSED_SCALE }, { duration: SCALE_SECONDS, ease: EASE }),
        false,
      )
      holdTimer = window.setTimeout(() => {
        holdTimer = undefined
        repeatTimer = window.setInterval(() => {
          if (!stepBy(direction)) {
            stopHold()
            settle(element)
            return
          }
          pulse(element)
        }, REPEAT_MS)
      }, HOLD_MS)
      return () => {
        stopHold()
        settle(element)
      }
    }

  onMount(() => {
    const cleanups: Array<() => void> = []
    if (minusButton !== undefined) cleanups.push(press(minusButton, hold(-1)))
    if (plusButton !== undefined) cleanups.push(press(plusButton, hold(1)))
    onCleanup(() => {
      for (const cleanup of cleanups) cleanup()
      stopHold()
      for (const element of [minusButton, plusButton, inputElement]) {
        if (element === undefined) continue
        motions.get(element)?.stop()
        element.style.transform = ''
      }
    })
  })

  const onStepClick = (direction: 1 | -1) => (event: MouseEvent): void => {
    // A pointer press already stepped inside the gesture; its click has a
    // click count. A keyboard activation reports `detail === 0` and steps here.
    if (event.detail !== 0) return
    stepBy(direction)
  }

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
          ref={(element) => {
            minusButton = element
          }}
          type="button"
          class="stepper-btn"
          aria-label={`Меньше: ${props.label}`}
          aria-describedby={`${props.id}-hold`}
          disabled={props.value <= props.min}
          onClick={onStepClick(-1)}
        >
          −
        </button>
        <input
          ref={(element) => {
            inputElement = element
          }}
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
            if (Number.isFinite(parsed)) props.onChange(clamp(Math.round(parsed)))
          }}
          onChange={(event) => {
            const parsed = Number(event.currentTarget.value)
            event.currentTarget.value = String(clamp(Number.isFinite(parsed) ? Math.round(parsed) : props.value))
          }}
        />
        <button
          ref={(element) => {
            plusButton = element
          }}
          type="button"
          class="stepper-btn"
          aria-label={`Больше: ${props.label}`}
          aria-describedby={`${props.id}-hold`}
          disabled={props.value >= props.max}
          onClick={onStepClick(1)}
        >
          +
        </button>
      </div>
      <span class="sr-only" id={`${props.id}-hold`}>
        {HOLD_HINT}
      </span>
      <Show when={props.hint !== undefined}>
        <div class="field-hint" id={`${props.id}-hint`}>
          {props.hint}
        </div>
      </Show>
    </div>
  )
}
