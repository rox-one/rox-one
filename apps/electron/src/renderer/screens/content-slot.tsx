/**
 * Portal slot for ScreenSidebarConfig group `content`: the config holds a
 * stable <Outlet/> that only provides a DOM node; the page portals its live
 * children into it. Page re-renders therefore never republish the config
 * (which would re-render the whole shell sidebar), and the children keep the
 * page's React context (providers above the page), like ShellSidebarPortal.
 */
import * as React from 'react'
import { createPortal } from 'react-dom'

export interface PortalSlot {
  Outlet: React.ComponentType
  subscribe(cb: () => void): () => void
  getTarget(): HTMLElement | null
}

export function createPortalSlot(className?: string): PortalSlot {
  let target: HTMLElement | null = null
  const listeners = new Set<() => void>()
  const setTarget = (el: HTMLElement | null) => {
    if (el === target) return
    target = el
    for (const l of listeners) l()
  }
  function Outlet() {
    return <div ref={setTarget} className={className} data-sidebar-content-slot="" />
  }
  return {
    Outlet,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    getTarget: () => target,
  }
}

/** One slot per page instance + the current outlet node (null until mounted). */
export function usePortalSlot(className?: string): [PortalSlot, HTMLElement | null] {
  const [slot] = React.useState(() => createPortalSlot(className))
  const target = React.useSyncExternalStore(slot.subscribe, slot.getTarget, () => null)
  return [slot, target]
}

/** Renders children into the slot's outlet once it is mounted. */
export function SlotPortal({ target, children }: { target: HTMLElement | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : null
}
