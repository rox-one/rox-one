import { animate } from 'motion'
import type { JSX } from 'solid-js'
import { onCleanup, onMount } from 'solid-js'

import { cx } from '@/lib/cx'
import { prefersReducedMotion } from '@/lib/motion'

/** The shared roll: short enough to feel like the label was flicked. */
const ROLL_SECONDS = 0.18
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]

export interface RollingTextProps {
  /** The visible words; the same words become the only accessible name. */
  text: string
  class?: string
}

/**
 * A label that rolls to its twin: the visible copy leaves downwards while a
 * copy waiting above slides in. The wrapper is clipped, so the window keeps
 * one line of height and the width of the word, and an icon may sit beside it.
 *
 * The real name lives in a hidden copy inside the same element, so a screen
 * reader hears «Запустить» once while the two moving copies stay decorative.
 * Hovering the nearest button or link rolls the pair, keyboard focus does the
 * same, and reduced motion leaves the label perfectly still.
 */
export function RollingText(props: RollingTextProps): JSX.Element {
  let host: HTMLSpanElement | undefined
  let leaving: HTMLSpanElement | undefined
  let entering: HTMLSpanElement | undefined
  let rolled = false
  let running: Array<{ stop: () => void }> = []

  const stop = (): void => {
    for (const controls of running) controls.stop()
    running = []
  }

  /** The settled state: the first copy shown, the second waiting above. */
  const rest = (): void => {
    if (leaving !== undefined) {
      leaving.style.transform = ''
      leaving.style.opacity = ''
    }
    if (entering !== undefined) {
      entering.style.transform = ''
      entering.style.opacity = ''
    }
  }

  const roll = (active: boolean): void => {
    if (active === rolled) return
    rolled = active
    if (leaving === undefined || entering === undefined) return
    stop()
    if (prefersReducedMotion()) {
      // Motion is unwanted: the label keeps its resting copy and does not move.
      rest()
      return
    }
    running = [
      animate(
        leaving,
        { y: active ? '100%' : '0%', opacity: active ? 0 : 1 },
        { duration: ROLL_SECONDS, ease: EASE },
      ),
      animate(
        entering,
        { y: active ? '0%' : '-100%', opacity: active ? 1 : 0 },
        { duration: ROLL_SECONDS, ease: EASE },
      ),
    ]
  }

  onMount(() => {
    if (host === undefined) return
    const root = host
    // A press on the whole control should roll the label, not only the glyphs.
    const target: HTMLElement = root.closest<HTMLElement>('button, a') ?? root
    const enter = (): void => roll(true)
    const leave = (): void => roll(false)
    const focusOut = (event: FocusEvent): void => {
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
      roll(false)
    }
    target.addEventListener('pointerenter', enter)
    target.addEventListener('pointerleave', leave)
    target.addEventListener('focusin', enter)
    target.addEventListener('focusout', focusOut)

    // Turning reduced motion on in the tab settles any copy that was mid-roll.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => {
      if (!query.matches) return
      stop()
      rolled = false
      rest()
    }
    query.addEventListener('change', onChange)

    onCleanup(() => {
      target.removeEventListener('pointerenter', enter)
      target.removeEventListener('pointerleave', leave)
      target.removeEventListener('focusin', enter)
      target.removeEventListener('focusout', focusOut)
      query.removeEventListener('change', onChange)
      stop()
    })
  })

  return (
    <span ref={host} class={cx('rolling-label', props.class)}>
      <span class="sr-only">{props.text}</span>
      <span class="rolling-window" aria-hidden="true">
        <span class="rolling-sizer">{props.text}</span>
        <span ref={leaving} class="rolling-layer rolling-out">
          {props.text}
        </span>
        <span ref={entering} class="rolling-layer rolling-in">
          {props.text}
        </span>
      </span>
    </span>
  )
}
