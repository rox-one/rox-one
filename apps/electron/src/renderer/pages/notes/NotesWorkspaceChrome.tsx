import * as React from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { canFocusNotesControl, isNotesPanelUnavailable } from './focus-state'

export function useNotesPanelWidth<T extends HTMLElement>() {
  const [element, setElement] = React.useState<T | null>(null)
  const ref = React.useCallback((node: T | null) => setElement(node), [])
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!element) return
    const update = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      // Retained, hidden workspace panels must not reset the last useful layout.
      if (next > 0) setWidth((previous) => previous === next ? previous : next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [ref, width] as const
}

/** Small tiles use the same tools in a focus-trapped sheet; the document stays mounted behind it. */
export function NotesResponsiveRail({
  inline,
  open,
  title,
  onClose,
  children,
  returnFocus,
}: {
  inline: boolean
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const ownerRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  React.useLayoutEffect(() => {
    if (open && !inline) returnFocusRef.current = document.activeElement as HTMLElement | null
  }, [open, inline])
  React.useEffect(() => {
    if (!open) return
    if (inline) { closeRef.current(); return }
    const owner = ownerRef.current
    if (!owner) return
    const check = () => { if (isNotesPanelUnavailable(owner)) closeRef.current() }
    const observer = new MutationObserver(check)
    for (let element: HTMLElement | null = owner; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] })
    }
    owner.ownerDocument.addEventListener('visibilitychange', check)
    check()
    return () => { observer.disconnect(); owner.ownerDocument.removeEventListener('visibilitychange', check) }
  }, [open, inline])
  if (inline) return <div ref={ownerRef} className="contents">{children}</div>
  return (
    <div ref={ownerRef} className="contents">
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="flex h-[min(600px,80dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // There is no DialogTrigger when a menu opens this sheet.
          const target = returnFocus?.current ?? returnFocusRef.current
          if (canFocusNotesControl(target)) target.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="shrink-0 border-b border-border-subtle px-4 py-3 pr-12 text-[13px]">{title}</DialogTitle>
        <div className="flex min-h-0 flex-1 overflow-hidden [&>aside]:!w-full [&>aside]:!border-0">{children}</div>
      </DialogContent>
    </Dialog>
    </div>
  )
}

