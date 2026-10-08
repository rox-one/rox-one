/**
 * OverlayPortalContext — where layered surfaces (dialogs, drawers) portal to.
 *
 * Fullscreen overlays (FullscreenOverlayBase, tokens/z.css --z-fullscreen: 350)
 * sit ABOVE the dialog scrim/modal layers (200/210), like main. A dialog or
 * drawer opened from inside one would therefore render under it if it portaled
 * to <body>. FullscreenOverlayBase provides its own root element here; the
 * shared Dialog / Drawer wrappers read it and portal into that element, so
 * their scrim and content stack inside the overlay, above its content.
 *
 * Outside an overlay the value is null and the wrappers portal to <body> as
 * before. Menus and tooltips keep portaling to <body>: their layers (island
 * 400, tooltip 450) are already above fullscreen.
 */

import { createContext, useContext, useState, type ReactNode } from 'react'

const OverlayPortalContainerContext = createContext<HTMLElement | null>(null)

/** The element dialogs/drawers should portal into, or null for <body>. */
export function useOverlayPortalContainer(): HTMLElement | null {
  return useContext(OverlayPortalContainerContext)
}

/**
 * The `container` a portal wrapper should pass on: an explicit container
 * wins, else the enclosing overlay's root, else undefined (the primitive's
 * default, <body>).
 */
export function useOverlayPortalTarget(explicit?: Element | DocumentFragment | null): Element | DocumentFragment | undefined {
  const overlayContainer = useOverlayPortalContainer()
  return explicit ?? overlayContainer ?? undefined
}

export interface OverlayPortalContainerProviderProps {
  /** The element to portal into (null: fall back to <body>). */
  container: HTMLElement | null
  children: ReactNode
}

export function OverlayPortalContainerProvider({ container, children }: OverlayPortalContainerProviderProps) {
  return (
    <OverlayPortalContainerContext.Provider value={container}>
      {children}
    </OverlayPortalContainerContext.Provider>
  )
}

export interface OverlayPortalRootProps {
  children: ReactNode
}

/**
 * Renders the overlay's portal root (an empty element after the children,
 * so portaled dialogs paint above the overlay content) and provides it to the
 * subtree. Use it inside any fullscreen surface that sits above the dialog
 * layers.
 */
export function OverlayPortalRoot({ children }: OverlayPortalRootProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  return (
    <OverlayPortalContainerProvider container={container}>
      {children}
      <div ref={setContainer} data-slot="overlay-portal-root" />
    </OverlayPortalContainerProvider>
  )
}
