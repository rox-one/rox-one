import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createNativeSurfaceTracker, type NativeBoundsRect } from '../lib/native-surface-visibility'
import { createNativeSurfaceInvalidator, isNativeSurfaceExplicitlyHidden, observeNativeSurfaceDOM, readNativeSurfaceDOMBounds, type NativeSurfaceDOMState } from '../lib/native-surface-dom'
import { nativeSurfaceOwners } from '../lib/native-surface-owners'
import { hasOpenOverlay } from '../lib/overlay-detection'
import { isPanelResizeActive, subscribePanelResizeActivity } from '../components/app-shell/resize-activity'

export type NativeSurfacePresentation = NativeSurfaceDOMState | 'unfocused' | 'suppressed'

/** Shared compositor contract for browser, SiYuan, and extension surface hosts. */
export function useNativeSurfaceBounds({ containerRef, instanceId, focused, removed, syncBounds }: {
  containerRef: RefObject<HTMLDivElement>
  instanceId: string | null
  focused: boolean
  removed: boolean
  syncBounds: (instanceId: string, rect: NativeBoundsRect | null) => Promise<unknown>
}): NativeSurfacePresentation {
  const syncRef = useRef(syncBounds)
  syncRef.current = syncBounds
  const [presentation, setPresentation] = useState<NativeSurfacePresentation>('hidden')

  useLayoutEffect(() => {
    if (!instanceId) return
    const element = containerRef.current
    const tracker = createNativeSurfaceTracker()
    tracker.mount()
    tracker.setFocused(focused)
    tracker.setRemoved(removed)
    const owner = nativeSurfaceOwners.acquire(instanceId, (id, rect) => syncRef.current(id, rect))
    const cheapHidden = () => removed || !focused || isNativeSurfaceExplicitlyHidden(element) || isPanelResizeActive()
    const updatePresentation = (state: NativeSurfacePresentation) => setPresentation(current => current === state ? current : state)
    const hide = () => {
      owner.update(null)
      updatePresentation(removed || isNativeSurfaceExplicitlyHidden(element) ? 'hidden' : !focused ? 'unfocused' : 'suppressed')
    }
    const sync = () => {
      if (isPanelResizeActive()) tracker.acquire('resize')
      else tracker.release('resize')
      if (hasOpenOverlay()) tracker.acquire('overlay')
      else tracker.release('overlay')
      if (tracker.snapshot.suppression.size > 0) {
        owner.update(null)
        updatePresentation('suppressed')
        return
      }
      const measured = readNativeSurfaceDOMBounds(element)
      tracker.setBounds(measured.rect)
      const decision = tracker.resolve(tracker.snapshot.generation)
      updatePresentation(measured.state)
      // Body mutations include editor typing: identical bounds produce no RPC.
      owner.update(decision.rect)
    }
    const invalidator = createNativeSurfaceInvalidator({
      paused: cheapHidden,
      hide,
      measure: sync,
      requestFrame: callback => requestAnimationFrame(callback),
      cancelFrame: frame => cancelAnimationFrame(frame),
    })
    invalidator.invalidate()
    const stopDOM = element ? observeNativeSurfaceDOM(element, invalidator.invalidate, () => focused && !removed) : () => {}
    const stopResize = subscribePanelResizeActivity(invalidator.invalidate)
    return () => {
      invalidator.dispose()
      tracker.unmount()
      stopDOM()
      stopResize()
      owner.release()
    }
  }, [containerRef, instanceId, focused, removed])

  return presentation
}
