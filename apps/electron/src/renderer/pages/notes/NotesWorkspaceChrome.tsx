import * as React from 'react'
import { ListTree, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  scopeKey,
}: {
  inline: boolean
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  returnFocus?: React.RefObject<HTMLElement | null>
  scopeKey?: string
}) {
  const ownerRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const returnScopeRef = React.useRef(scopeKey)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  React.useLayoutEffect(() => {
    if (open && !inline) { returnFocusRef.current = document.activeElement as HTMLElement | null; returnScopeRef.current = scopeKey }
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
          if (returnScopeRef.current === scopeKey && canFocusNotesControl(target)) target.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="shrink-0 border-b border-border-subtle px-4 py-3 pr-12 text-[13px]">{title}</DialogTitle>
        <div className="flex min-h-0 flex-1 overflow-hidden [&>aside]:!w-full [&>aside]:!border-0">{children}</div>
      </DialogContent>
    </Dialog>
    </div>
  )
}


/** Shared actual NativeNotesPage tool controls; sheets never change saved rail preferences. */
export function NotesRailTools({ tocShown, commentsShown, sheet, onCollapse, onOpen }: {
  tocShown: boolean; commentsShown: boolean; sheet: 'toc' | 'comments' | null
  onCollapse: (rail: 'toc' | 'comments') => void; onOpen: (rail: 'toc' | 'comments') => void
}) {
  const { t } = useTranslation()
  return <div className="ml-auto flex shrink-0 gap-1 pr-2">
    <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-foreground/[0.08]" aria-label={t('notes.toc.title')} title={t('notes.toc.title')} aria-haspopup={tocShown ? undefined : 'dialog'} aria-expanded={tocShown || sheet === 'toc'} onClick={() => { if (tocShown) onCollapse('toc'); else onOpen('toc') }}><ListTree className="size-3.5" aria-hidden /></button>
    <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-foreground/[0.08]" aria-label={t('notes.comments.title')} title={t('notes.comments.title')} aria-haspopup={commentsShown ? undefined : 'dialog'} aria-expanded={commentsShown || sheet === 'comments'} onClick={() => { if (commentsShown) onCollapse('comments'); else onOpen('comments') }}><MessageSquare className="size-3.5" aria-hidden /></button>
  </div>
}
