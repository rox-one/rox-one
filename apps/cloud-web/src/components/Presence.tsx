/**
 * A node that leaves instead of vanishing. Solid removes a node the moment its
 * condition flips, so this wrapper owns the last `--dur-base` of its life:
 * it sets `data-state="exiting"` on itself while CSS fades the child, then
 * unmounts and reports the end. Reduced motion skips the wait entirely.
 */
import { Show, createEffect, createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'
import { baseDurationMs } from '@/lib/motion'

export interface PresenceProps {
  /** Flip to `true` to let the node go; flip back to keep it on screen. */
  exiting: boolean
  /** Called once, after the exit finished and the node is gone. */
  onExitEnd?: () => void
  class?: string
  children?: JSX.Element
}

export function Presence(props: PresenceProps): JSX.Element {
  const [mounted, setMounted] = createSignal(true)
  const [exiting, setExiting] = createSignal(false)
  let timer: number | undefined

  const clear = (): void => {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
  }

  createEffect(() => {
    if (!props.exiting) {
      // A new message arrived during the fade: stay, and drop the exit state.
      clear()
      setMounted(true)
      setExiting(false)
      return
    }
    if (!mounted()) return
    const wait = baseDurationMs()
    if (wait === 0) {
      setMounted(false)
      setExiting(false)
      // The parent usually forgets the node in reaction to this call; let the
      // effect that asked finish first.
      queueMicrotask(() => props.onExitEnd?.())
      return
    }
    setExiting(true)
    clear()
    timer = window.setTimeout(() => {
      timer = undefined
      setMounted(false)
      setExiting(false)
      props.onExitEnd?.()
    }, wait)
  })

  onCleanup(clear)

  return (
    <Show when={mounted()}>
      <div
        class={cx('presence', props.class)}
        data-state={exiting() ? 'exiting' : undefined}
        aria-hidden={exiting() ? 'true' : undefined}
      >
        {props.children}
      </div>
    </Show>
  )
}
