/**
 * Shared lazy `motion/react`. Island and BrowserControls live in the same
 * Vite shared chunk as the main-window Spinner (playground.html is a second
 * entry). A static import here puts motion-dom in index.html's preload graph.
 * Dynamic import() keeps first paint on plain DOM; idle-preload loads motion.
 */

import * as React from 'react'
import { useSyncExternalStore, type ReactNode } from 'react'

type MotionMod = typeof import('motion/react')

let loaded: MotionMod | null = null
const listeners = new Set<() => void>()
let inflight: Promise<MotionMod> | null = null

export function loadMotion(): Promise<MotionMod> {
  if (loaded) return Promise.resolve(loaded)
  inflight ??= import('motion/react').then((mod) => {
    loaded = mod
    for (const listener of listeners) listener()
    return mod
  })
  return inflight
}

function subscribe(onStoreChange: () => void): () => void {
  void loadMotion()
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function useMotionModule(): MotionMod | null {
  return useSyncExternalStore(subscribe, () => loaded, () => loaded)
}

const MOTION_ONLY_KEYS = [
  'initial',
  'animate',
  'exit',
  'transition',
  'variants',
  'layout',
  'layoutId',
  'custom',
  'inherit',
  'onAnimationComplete',
  'onAnimationStart',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
] as const

function stripMotionProps<T extends Record<string, unknown>>(props: T): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...props }
  for (const key of MOTION_ONLY_KEYS) delete rest[key]
  return rest
}

function createMotionTag(tag: string) {
  const Comp = React.forwardRef<HTMLElement, Record<string, unknown>>(function DeferredMotionTag(props, ref) {
    const mod = useMotionModule()
    if (!mod) {
      return React.createElement(tag, { ...stripMotionProps(props), ref })
    }
    const El = (mod.motion as unknown as Record<string, React.ElementType>)[tag] ?? tag
    return React.createElement(El, { ...props, ref })
  })
  Comp.displayName = `DeferredMotion.${tag}`
  return Comp
}

const motionCache = new Map<string, ReturnType<typeof createMotionTag>>()

export const motion = new Proxy(
  {},
  {
    get(_target, tag: string) {
      let comp = motionCache.get(tag)
      if (!comp) {
        comp = createMotionTag(tag)
        motionCache.set(tag, comp)
      }
      return comp
    },
  },
) as typeof import('motion/react').motion

export function AnimatePresence({
  children,
  ...props
}: React.ComponentProps<typeof import('motion/react').AnimatePresence>): React.ReactElement {
  const mod = useMotionModule()
  if (!mod) return <>{children}</>
  return <mod.AnimatePresence {...props}>{children}</mod.AnimatePresence>
}

/**
 * Drop-in for motion's useIsPresent when the real PresenceContext is not
 * mounted yet. Always true on the static fallback path; after load, an inner
 * component calls the real hook (hooks cannot be conditional in the parent).
 */
export function useIsPresent(): boolean {
  return true
}

const LoadedPresentDiv = React.forwardRef<
  HTMLDivElement,
  { mod: MotionMod; children?: ReactNode | ((present: boolean) => ReactNode) } & Record<string, unknown>
>(function LoadedPresentDiv({ mod, children, ...props }, ref) {
  const isPresent = mod.useIsPresent()
  return (
    <mod.motion.div
      {...props}
      ref={ref}
      aria-hidden={!isPresent || undefined}
      {...(!isPresent ? { inert: '' } : {})}
    >
      {typeof children === 'function' ? children(isPresent) : children}
    </mod.motion.div>
  )
})

/** motion.div bound to AnimatePresence (inert + aria-hidden on exit). */
export const PresenceDiv = React.forwardRef<
  HTMLDivElement,
  Record<string, unknown> & { children?: ReactNode | ((present: boolean) => ReactNode) }
>(function PresenceDiv({ children, ...props }, ref) {
  const mod = useMotionModule()
  if (!mod) {
    return (
      <div {...stripMotionProps(props)} ref={ref}>
        {typeof children === 'function' ? children(true) : children}
      </div>
    )
  }
  return (
    <LoadedPresentDiv mod={mod} {...props} ref={ref}>
      {children}
    </LoadedPresentDiv>
  )
})

export function DeferredMotionConfig({
  children,
  reducedMotion,
}: {
  children: ReactNode
  reducedMotion: 'always' | 'user' | 'never'
}): React.ReactElement {
  const mod = useMotionModule()
  if (!mod) return <>{children}</>
  return <mod.MotionConfig reducedMotion={reducedMotion}>{children}</mod.MotionConfig>
}
