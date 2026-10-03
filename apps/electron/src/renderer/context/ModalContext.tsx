import React, { createContext, useContext, useMemo, useRef } from 'react'

/**
 * Modal registry context - tracks open modals for layered close handling.
 *
 * Cmd+W (keyboard close) checks this registry first: if a modal is open,
 * the topmost modal is closed before panels/window.
 *
 * Modals register themselves with a priority (higher = closed first) and a close handler.
 */

export interface ModalSnapshot {
  readonly id: string
  readonly priority: number
}

interface RegisteredModal extends ModalSnapshot {
  id: string
  priority: number
  close: () => void
  order: number
}

export interface ModalContextValue {
  /** Cached reactive list of open layers, ordered by close priority. */
  getSnapshot: () => readonly ModalSnapshot[]
  subscribe: (listener: () => void) => () => void
  /** Register a modal when it opens. Returns unregister function. */
  registerModal: (id: string, close: () => void, priority?: number) => () => void
  /** Check if any modals are open */
  hasOpenModals: () => boolean
  /** Close the topmost modal (highest priority). Returns true if a modal was closed. */
  closeTopModal: () => boolean
}

const ModalContext = createContext<ModalContextValue | null>(null)

/** Registry preserves imperative close handling and adds reactive snapshots. */
export function createModalRegistry(): ModalContextValue {
  const modals = new Map<string, RegisteredModal>()
  const listeners = new Set<() => void>()
  let order = 0
  let snapshot: readonly ModalSnapshot[] = Object.freeze([])
  const publish = () => {
    snapshot = Object.freeze(Array.from(modals.values())
      .sort((a, b) => b.priority - a.priority || b.order - a.order)
      .map(({ id, priority }) => Object.freeze({ id, priority })))
    for (const listener of listeners) listener()
  }
  return {
    registerModal(id, close, priority = 0) {
      const registration = { id, close, priority, order: ++order }
      modals.set(id, registration)
      publish()
      return () => {
        // StrictMode cleanup from a prior registration must not remove its replacement.
        if (modals.get(id) !== registration) return
        modals.delete(id)
        publish()
      }
    },
    hasOpenModals: () => modals.size > 0,
    closeTopModal: () => {
      const top = snapshot[0]
      if (!top) return false
      modals.get(top.id)?.close()
      return true
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Provider for the existing Cmd+W modal-close path. */
export function ModalProvider({ children }: { children: React.ReactNode }) {
  const registry = useMemo(() => createModalRegistry(), [])
  return <ModalContext.Provider value={registry}>{children}</ModalContext.Provider>
}

/**
 * Hook to access modal registry functions.
 */
/** Shared primitives may render in isolated roots without an app registry. */
export function useOptionalModalRegistry(): ModalContextValue | null {
  return useContext(ModalContext)
}

export function useModalRegistry() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModalRegistry must be used within a ModalProvider')
  }
  return context
}

/**
 * Hook to register a modal. Call this in your modal component.
 * The modal will be automatically unregistered when the component unmounts.
 *
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Function to close the modal
 * @param priority - Higher priority modals are closed first (default: 0)
 *
 * @example
 * ```tsx
 * function MyDialog({ open, onClose }) {
 *   useRegisterModal(open, onClose)
 *   return <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>...</Dialog>
 * }
 * ```
 */
export function useRegisterModal(isOpen: boolean, onClose: () => void, priority = 0) {
  const { registerModal } = useModalRegistry()
  const idRef = useRef(`modal-${Math.random().toString(36).slice(2)}`)

  React.useEffect(() => {
    if (isOpen) {
      const unregister = registerModal(idRef.current, onClose, priority)
      return unregister
    }
  }, [isOpen, onClose, priority, registerModal])
}
