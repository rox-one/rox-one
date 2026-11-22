import { For, Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, useContext } from 'solid-js'
import type { JSX } from 'solid-js'
import { animate } from 'motion'

import { baseDurationMs, prefersReducedMotion } from '@/lib/motion'

import { Icon } from './Icon'
import { Presence } from './Presence'

export type ToastTone = 'accent' | 'success' | 'warning' | 'danger'

export interface ToastInput {
  message: string
  tone?: ToastTone
  /** Extra line for a code or a request id. */
  meta?: string
  requestId?: string | null
  /** `0` keeps the toast until it is dismissed. */
  timeoutMs?: number
}

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  meta?: string
  requestId?: string | null
}

export interface ToastApi {
  show: (input: ToastInput | string, tone?: ToastTone) => number
  success: (message: string) => number
  error: (input: unknown) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

/** The four newest messages stay on screen; anything older is trimmed. */
const MAX_VISIBLE = 4
/** Each step back lifts a card this far, shrinks it 6% and fades it 20% more. */
const STACK_STEP_Y = 10
const STACK_STEP_SCALE = 0.06
const STACK_STEP_OPACITY = 0.2
/** The gap between cards while the pile is fanned out on hover or focus. */
const STACK_GAP = 8
/** Crossing the gap between two cards must not fold the stack back up. */
const COLLAPSE_DELAY_MS = 120
const DEFAULT_TIMEOUT_MS = 5000
/** A new card rises from this far below its place. */
const ENTER_FROM_Y = 18
const ENTER_FROM_SCALE = 0.96
/** The curve of the design tokens (`--ease`), written out for Motion. */
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]

/** Where one card sits in the pile. `depth` 0 is the newest, fully readable one. */
interface StackPose {
  depth: number
  y: number
  scale: number
  opacity: number
}

/** Turn anything thrown by the client into a message, its code and its request id. */
function describeError(input: unknown): { message: string; code: string | null; requestId: string | null } {
  if (typeof input === 'string') return { message: input, code: null, requestId: null }
  if (!(input instanceof Error)) return { message: 'Неизвестная ошибка', code: null, requestId: null }
  const requestId =
    'requestId' in input && typeof input.requestId === 'string' && input.requestId.length > 0
      ? input.requestId
      : null
  const code = 'code' in input && typeof input.code === 'string' ? input.code : null
  return { message: input.message, code, requestId }
}

interface StackCardProps {
  item: ToastItem
  pose: () => StackPose
  exiting: () => boolean
  reduced: () => boolean
  /** Natural height, reported without transforms, used to fan the pile out. */
  onMeasure: (id: number, height: number) => void
  onDismiss: (id: number) => void
}

/**
 * One card in the pile. Its resting place is an inline transform that Motion
 * animates when the stack's depth changes; the card itself keeps its natural
 * size, so no frame ever animates layout. Reduced motion leaves the card
 * alone entirely and `styles/motion.css` lays the stack out as a plain list.
 */
function StackCard(props: StackCardProps): JSX.Element {
  let element: HTMLDivElement | undefined
  let entered = false

  createEffect(() => {
    const node = element
    if (node === undefined) return
    if (props.reduced()) {
      node.style.opacity = ''
      node.style.transform = ''
      node.style.zIndex = ''
      return
    }
    // A card on its way out keeps the pose it had; motion.css fades it there.
    if (props.exiting()) return
    const target = props.pose()
    // The newest card paints on top of the ones behind it.
    node.style.zIndex = String(MAX_VISIBLE - target.depth)
    if (!entered) {
      entered = true
      // The first frame is set here, not read from the DOM: a card always
      // rises from below, even if the stylesheet has not settled yet.
      node.style.opacity = '0'
      node.style.transform = `translateY(${ENTER_FROM_Y}px) scale(${ENTER_FROM_SCALE})`
    }
    const controls = animate(
      node,
      { y: target.y, scale: target.scale, opacity: target.opacity },
      { duration: baseDurationMs() / 1000, ease: EASE },
    )
    onCleanup(() => controls.stop())
  })

  onMount(() => {
    const node = element
    if (node === undefined) return
    const report = (): void => {
      props.onMeasure(props.item.id, node.offsetHeight)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(node)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="toast" data-tone={props.item.tone} role="status" ref={element}>
      <Icon
        class="toast-icon"
        name={props.item.tone === 'danger' ? 'shield' : props.item.tone === 'success' ? 'check' : 'log'}
        size={16}
      />
      <div class="toast-body">
        <div class="toast-message">{props.item.message}</div>
        <Show when={props.item.meta !== undefined || props.item.requestId !== null}>
          <div class="toast-meta">
            {props.item.meta}
            {props.item.meta !== undefined && props.item.requestId !== null ? ' · ' : null}
            {props.item.requestId === null ? null : `запрос ${props.item.requestId}`}
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="toast-close"
        aria-label="Закрыть сообщение"
        tabIndex={props.exiting() ? -1 : 0}
        onClick={() => props.onDismiss(props.item.id)}
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider(props: { children?: JSX.Element }): JSX.Element {
  const [items, setItems] = createSignal<ToastItem[]>([])
  // A dismissed toast stays for the base step of its own fade. The set is a
  // signal of its own, so the item keeps its identity and its DOM node.
  const [leaving, setLeaving] = createSignal<ReadonlySet<number>>(new Set<number>())
  // Natural heights, by toast id, so a fanned-out stack can put every card
  // fully above the one in front of it without animating layout.
  const [heights, setHeights] = createSignal<Record<number, number>>({})
  const [hovered, setHovered] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [reduced, setReduced] = createSignal(prefersReducedMotion())
  const timers = new Map<number, number>()
  let settleTimer: number | undefined
  let nextId = 1

  /** The cards that count, newest first. A card on its way out no longer does. */
  const stack = createMemo(() => items().filter((item) => !leaving().has(item.id)).reverse())
  const expanded = (): boolean => hovered() || focused()

  const clearTimer = (id: number): void => {
    const timer = timers.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    timers.delete(id)
  }

  const armTimer = (id: number, ms: number): void => {
    clearTimer(id)
    if (!(ms > 0)) return
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id)
        beginLeave(id)
      }, ms),
    )
  }

  /**
   * A timer may fire after the person closed the toast; a forgotten id has
   * nothing left to fade and must not linger in the set.
   */
  const beginLeave = (id: number): void => {
    if (!items().some((item) => item.id === id) || leaving().has(id)) return
    clearTimer(id)
    setLeaving((current) => new Set(current).add(id))
  }

  const forget = (id: number): void => {
    clearTimer(id)
    setItems((list) => list.filter((item) => item.id !== id))
    // A vanished card takes the pointer's hover with it; a stale flag would
    // otherwise fan out the very next message before anyone touched it.
    if (items().length === 0) {
      setHovered(false)
      setFocused(false)
    }
    setLeaving((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
    setHeights((current) => {
      if (current[id] === undefined) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const measure = (id: number, height: number): void => {
    if (!Number.isFinite(height) || height <= 0) return
    setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }))
  }

  /** The depth a card shows at. A card on its way out is already off the list. */
  const depthOf = (id: number): number => {
    const found = stack().findIndex((item) => item.id === id)
    return Math.max(0, Math.min(found, MAX_VISIBLE - 1))
  }

  const poseOf = (id: number): StackPose => {
    const depth = depthOf(id)
    if (expanded()) {
      // Fan out: lift every card above the full height of everything in front
      // of it, so all four faces are readable. The newest card never moves.
      const order = stack()
      let y = 0
      for (let position = 0; position < depth; position += 1) {
        const inFront = order[position]
        if (inFront === undefined) break
        y += (heights()[inFront.id] ?? 0) + STACK_GAP
      }
      return { depth, y: -y, scale: 1, opacity: 1 }
    }
    return {
      depth,
      y: -depth * STACK_STEP_Y,
      scale: 1 - depth * STACK_STEP_SCALE,
      opacity: 1 - depth * STACK_STEP_OPACITY,
    }
  }

  /**
   * The oldest message gives way first, an error only when nothing else can.
   * The newest toast is never part of the overflow, so a fresh error stays.
   */
  const trim = (): void => {
    for (let guard = 0; guard < MAX_VISIBLE * 2; guard += 1) {
      const order = stack()
      if (order.length <= MAX_VISIBLE) return
      const oldestFirst = order.slice(MAX_VISIBLE).reverse()
      const victim = oldestFirst.find((item) => item.tone !== 'danger') ?? oldestFirst[0]
      if (victim === undefined) return
      beginLeave(victim.id)
    }
  }

  const show = (input: ToastInput | string, tone: ToastTone = 'accent'): number => {
    const value: ToastInput = typeof input === 'string' ? { message: input } : input
    const wantedTone = value.tone ?? tone
    // The same message, code and request id are one message: the live card
    // gets a fresh timer instead of a second copy of itself.
    const same = items().find(
      (item) =>
        !leaving().has(item.id) &&
        item.message === value.message &&
        item.tone === wantedTone &&
        item.meta === value.meta &&
        item.requestId === (value.requestId ?? null),
    )
    if (same !== undefined) {
      armTimer(same.id, value.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      return same.id
    }
    const id = nextId++
    setItems((list) => [
      ...list,
      {
        id,
        message: value.message,
        tone: wantedTone,
        meta: value.meta,
        requestId: value.requestId ?? null,
      },
    ])
    armTimer(id, value.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    trim()
    return id
  }

  const openStack = (): void => {
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer)
      settleTimer = undefined
    }
    setHovered(true)
  }

  const closeStackSoon = (): void => {
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined
      setHovered(false)
    }, COLLAPSE_DELAY_MS)
  }

  const leaveIfOutside = (event: FocusEvent & { currentTarget: HTMLDivElement }): void => {
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(false)
  }

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => {
      setReduced(query.matches)
    }
    query.addEventListener('change', onChange)
    onCleanup(() => query.removeEventListener('change', onChange))
  })

  onCleanup(() => {
    timers.forEach((timer) => window.clearTimeout(timer))
    timers.clear()
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer)
      settleTimer = undefined
    }
  })

  const api: ToastApi = {
    show,
    success: (message) => show({ message, tone: 'success' }),
    error: (input) => {
      const described = describeError(input)
      return show({
        message: described.message,
        tone: 'danger',
        meta: described.code ?? undefined,
        requestId: described.requestId,
      })
    },
    dismiss: beginLeave,
  }

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <div
        class="toast-region"
        data-expanded={expanded() ? 'true' : undefined}
        aria-live="polite"
        aria-atomic="false"
        onPointerEnter={openStack}
        onPointerLeave={closeStackSoon}
        onFocusIn={() => setFocused(true)}
        onFocusOut={leaveIfOutside}
      >
        <For each={items()}>
          {(item) => (
            <Presence
              exiting={leaving().has(item.id)}
              onExitEnd={() => {
                // A toast may leave from inside its own effect; forget it on
                // the next microtask, once that effect has finished.
                queueMicrotask(() => forget(item.id))
              }}
            >
              <StackCard
                item={item}
                pose={() => poseOf(item.id)}
                exiting={() => leaving().has(item.id)}
                reduced={reduced}
                onMeasure={measure}
                onDismiss={beginLeave}
              />
            </Presence>
          )}
        </For>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (value === undefined) throw new Error('useToast вызван вне ToastProvider')
  return value
}
